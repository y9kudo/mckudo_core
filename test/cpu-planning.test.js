import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createCpuPool } from '../src/cpu-pool.js';
import { createExplorationPlanner } from '../src/exploration-planner.js';
import {planExploration} from '../src/exploration.js';
import { captureVoxels, readVoxelSnapshot } from '../src/voxel-snapshot.js';

const air = { name:'air', boundingBox:'empty', shapes:[], stateId:0 };
const stone = { name:'stone', boundingBox:'block', shapes:[[0,0,0,1,1,1]], stateId:1 };
const position = {x:0,y:64,z:0};
const world = () => ({ dimension:'minecraft:overworld',revision:0,blockAt:p=>p.y<64?stone:air });

test('cave drop limits survive worker serialization and reject irreversible ledges',async()=>{
  const getBlock=p=>p.y<(p.x<=0?64:61)?stone:air;
  const options={position,mode:'ores',radius:8,maxNodes:3000,maxCandidates:24};
  assert.equal(planExploration({...options,getBlock,maxDrop:3}).target.y,61);
  const safe=planExploration({...options,getBlock,maxDrop:1});
  assert.ok(!safe.target||safe.target.y>=64);
  const pool=createCpuPool();
  try{
    const voxels=await captureVoxels({...options,getBlock});
    const actual=await pool.run({type:'exploration',voxels,options:{...options,maxDrop:1},costs:[]});
    assert.deepEqual(actual,planExploration({...options,getBlock:readVoxelSnapshot(voxels),maxDrop:1}));
    assert.ok(!actual.target||actual.target.y>=64);
  }finally{await pool.close();}
});

test('CPU exploration uses observed geometry, preserves unknowns and reuses a worker', async () => {
  const pool = createCpuPool(), voxels = await captureVoxels({ position, radius:8, getBlock:p=>p.x===5?null:p.y<64?stone:air });
  const getBlock = readVoxelSnapshot(voxels); assert.equal(getBlock({x:5,y:64,z:0}),null); assert.equal(getBlock({x:100,y:64,z:0}),null);
  const input = { type:'exploration',voxels,options:{position,radius:8,maxNodes:1000},costs:[] };
  try {
    const a = await pool.run(input), b = await pool.run(input);
    assert.equal(a.status,'planned'); assert.deepEqual(a,b); assert.equal(pool.snapshot().threads,1); assert.equal(pool.snapshot().completed,2);
  } finally { await pool.close(); }
});

test('CPU queue is bounded, queued cancellation does not kill unrelated work, malformed jobs recover', async () => {
  const pool=createCpuPool({maxQueue:2}), abort=new AbortController();
  try {
    const first=pool.run({type:'invalid'}).catch(e=>e.message);
    const cancelled=pool.run({type:'invalid'},{signal:abort.signal}).catch(e=>e.message);
    await assert.rejects(pool.run({type:'invalid'}),/full/);
    abort.abort(new Error('cancel queued'));
    assert.equal(await cancelled,'cancel queued'); assert.match(await first,/Unknown/);
    await assert.rejects(pool.run({type:'exploration',voxels:{}}),/snapshot/);
    assert.equal(pool.snapshot().cancelled,1); assert.equal(pool.snapshot().pending,0);
  } finally { await pool.close(); }
  await assert.rejects(pool.run({}),/closed/);
});

test('cancelling an active CPU job replaces its thread and the pool remains usable', async () => {
  const pool=createCpuPool(),abort=new AbortController();
  try {
    const cancelled=pool.run({type:'invalid'},{signal:abort.signal});abort.abort(new Error('cancel active'));
    await assert.rejects(cancelled,/cancel active/);
    await assert.rejects(pool.run({type:'invalid'}),/Unknown/);
    assert.equal(pool.snapshot().pending,0);
  } finally { await pool.close(); }
});

test('reactor exploration returns immediately, discards stale geometry and closes pending work', async () => {
  const pool=createCpuPool(), w=world();let ready=0;
  const planner=createExplorationPlanner({world:w,pool,onReady:()=>ready++});
  const options={position,radius:8,maxNodes:800};
  try {
    assert.equal(planner.poll(options).status,'pending');
    w.revision++;
    assert.equal(planner.poll(options).status,'pending');
    let result;
    for(let i=0;i<200;i++){await delay(10);result=planner.poll(options);if(result.status!=='pending')break;}
    assert.equal(result.status,'planned');assert.ok(ready>=1);assert.ok(planner.snapshot().stale>=1);
    const changed={...options,position:{x:2,y:64,z:0}};assert.equal(planner.poll(changed).status,'pending');
    planner.close();assert.equal(planner.poll(options).status,'blocked');
  } finally {planner.close();await pool.close();}
});

test('copying the voxel snapshot yields to events and honours abort without treating unloaded cells as air', async () => {
  const abort=new AbortController();let handled=false;
  const immediate=setImmediate(()=>{handled=true;abort.abort(new Error('urgent threat'));});
  try {await assert.rejects(captureVoxels({position,radius:24,getBlock:()=>null,signal:abort.signal}),/urgent threat/);assert.equal(handled,true);}
  finally{clearImmediate(immediate);}
});

test('independent cave and frontier requests share workers without cancelling each other',async()=>{
  const pool=createCpuPool(),parent=createExplorationPlanner({world:world(),pool}),child=parent.fork();
  const a={position,radius:8,context:'frontier'},b={...a,context:'cave'};
  try{
    assert.equal(parent.poll(a).status,'pending');assert.equal(child.poll(b).status,'pending');
    for(let i=0;i<200;i++){await delay(10);if(parent.poll(a).status!=='pending'&&child.poll(b).status!=='pending')break;}
    assert.equal(parent.poll(a).status,'planned');assert.equal(child.poll(b).status,'planned');
    assert.equal(parent.snapshot().stale,0);assert.equal(child.snapshot().stale,0);
    assert.equal(pool.snapshot().threads,1);
    parent.close();assert.equal(child.poll(b).status,'blocked');assert.throws(()=>parent.fork(),/closed/);
  }finally{parent.close();await pool.close();}
});
