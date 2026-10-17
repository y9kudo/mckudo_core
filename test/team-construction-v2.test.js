import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import nbt from 'prismarine-nbt';
import {createConstructionProject,runConstructionBatch,createAgentManager,blockKey} from '../overmindmc.js';

const dimension='minecraft:overworld',worldId='construction-test',names=['Atlas','Blake','Casey'];
const blueprint=(count=6)=>({schemaVersion:1,cells:Array.from({length:count},(_,x)=>({x,y:64,z:0,block:'minecraft:stone'}))});
function fixture(options={}){
  let time=0;const blocks=new Map(),calls=[];
  const readBlock=p=>blocks.get(blockKey(p))||(p.y===63?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});
  const project=createConstructionProject({id:'wall',worldId,dimension,blueprint:blueprint(),agents:names,clock:()=>time,...options});
  const context=agent=>({agent,worldId,dimension,position:{x:0,y:64,z:2},inventory:{'minecraft:stone':64},creative:false,readBlock});
  const clients=names.map(username=>Object.assign(new EventEmitter(),{
    options:{username},state:{status:'ready',health:20,gameMode:'survival',dimension,position:{x:0,y:64,z:2}},
    inventory:{snapshot:()=>({'minecraft:stone':64}),count:()=>64,items:()=>[]},world:{blockAt:readBlock},
    describe:()=>({skills:['place']}),snapshot(){return {...this.state};},
    async execute(a,{signal}={}){signal?.throwIfAborted();calls.push({agent:username,...a});await new Promise(r=>setImmediate(r));signal?.throwIfAborted();blocks.set(blockKey(a.args),{name:a.args.block.replace('minecraft:',''),boundingBox:'block'});return {ok:true};},
    async close(){this.state.status='disconnected';}
  }));
  return {project,context,blocks,readBlock,clients,calls,advance:n=>time+=n};
}

test('simultaneous workers claim distinct cells and complete through fresh observations',async()=>{
  const f=fixture();const results=await Promise.all(f.clients.map(c=>runConstructionBatch(c,f.project)));
  assert.equal(f.project.snapshot().status,'completed');assert.equal(f.project.snapshot().confirmed,6);
  assert.equal(new Set(f.calls.map(c=>blockKey(c.args))).size,6);assert.equal(f.calls.length,6);
  assert.equal(new Set(f.calls.map(c=>c.agent)).size,3);assert.equal(results.reduce((n,r)=>n+r.confirmed,0),6);
  assert.equal(f.project.snapshot().leases.length,0);
});

test('placing supported lower cells unlocks upper layers without external partition scripts',async()=>{
  const f=fixture({blueprint:{schemaVersion:1,cells:[{x:0,y:65,z:0,block:'minecraft:stone'},{x:0,y:64,z:0,block:'minecraft:stone'}]}});
  await runConstructionBatch(f.clients[0],f.project);
  assert.deepEqual(f.calls.map(c=>c.args.y),[64,65]);assert.equal(f.project.snapshot().status,'completed');
});

test('unknown terrain, missing support and occupied cells cannot cause destructive actions',()=>{
  for(const kind of ['unknown','unsupported','occupied']){
    const f=fixture();const c=f.context('Atlas');
    c.readBlock=()=>kind==='unknown'?null:{name:kind==='occupied'?'glass':'air',boundingBox:kind==='occupied'?'block':'empty'};
    const result=f.project.claim(c);assert.equal(result.status,'blocked');assert.equal(f.project.snapshot().leases.length,0);
  }
});

test('materials are per worker; a shortage does not prevent equipped teammates from working',()=>{
  const f=fixture();assert.equal(f.project.claim({...f.context('Atlas'),inventory:{}}).status,'needs-materials');
  assert.equal(f.project.claim(f.context('Blake')).status,'claimed');
});

test('an agent has one active claim and changed tokens fence expired workers',()=>{
  const f=fixture({leaseMs:300}),ctx=f.context('Atlas'),old=f.project.claim(ctx);
  assert.equal(f.project.claim(ctx).status,'busy');f.advance(301);
  const fresh=f.project.claim(f.context('Blake'));assert.equal(fresh.action.args.x,old.action.args.x);
  assert.equal(f.project.renew({...ctx,token:old.lease.token}),false);
  assert.equal(f.project.release({...ctx,token:old.lease.token}),false);
  assert.equal(f.project.finish({...ctx,token:old.lease.token}).status,'stale');
  assert.equal(f.project.snapshot().leases[0].agent,'Blake');
});

test('renewed claims remain owned and explicit cancellation releases without a failed attempt',()=>{
  const f=fixture({leaseMs:300}),ctx=f.context('Atlas'),j=f.project.claim(ctx);f.advance(200);
  assert.equal(f.project.renew({...ctx,token:j.lease.token}),true);f.advance(200);assert.equal(f.project.snapshot().leases.length,1);
  assert.equal(f.project.release({...ctx,token:j.lease.token}),true);assert.equal(f.project.snapshot().cells[0].attempts,0);
});

test('executor success without an observed block exhausts a bounded retry budget',async()=>{
  const f=fixture({blueprint:blueprint(1)});f.clients[0].execute=async()=>({ok:true});
  const r=await runConstructionBatch(f.clients[0],f.project);
  assert.equal(r.status,'blocked');assert.equal(r.actions,2);assert.equal(r.confirmed,0);
  assert.equal(r.project.cells[0].attempts,2);assert.equal(r.project.status,'pending');
});

test('an executor error after a confirmed world change is reconciled as success',async()=>{
  const f=fixture({blueprint:blueprint(1)});f.clients[0].execute=async a=>{f.blocks.set(blockKey(a.args),{name:'stone',boundingBox:'block'});throw new Error('ack timeout');};
  const r=await runConstructionBatch(f.clients[0],f.project);assert.equal(r.status,'completed');assert.equal(r.confirmed,1);assert.equal(r.project.cells[0].attempts,0);
});

test('checkpoint restoration preserves failures but never restores claims or world success',async()=>{
  const f=fixture({blueprint:blueprint(1)});await runConstructionBatch(f.clients[0],f.project);
  const restored=createConstructionProject({id:'wall',worldId,dimension,blueprint:blueprint(1),agents:names,checkpoint:f.project.checkpoint()});
  assert.equal(restored.snapshot().confirmed,0);assert.equal(restored.snapshot().cells[0].state,'unknown');assert.equal(restored.snapshot().leases.length,0);
  assert.equal(restored.claim({...f.context('Atlas'),readBlock:p=>p.y===63?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}}).status,'claimed');
  assert.throws(()=>createConstructionProject({id:'different',worldId,dimension,blueprint:blueprint(1),agents:names,checkpoint:f.project.checkpoint()}),/match/);
});

test('corrupt checkpoint, duplicate agents, oversized constraints and stateful cells are rejected',()=>{
  const opts={id:'wall',worldId,dimension,blueprint:blueprint(1),agents:names};
  assert.throws(()=>createConstructionProject({...opts,agents:['Atlas','Atlas']}));
  assert.throws(()=>createConstructionProject({...opts,blueprint:{schemaVersion:1,cells:[{...blueprint(1).cells[0],properties:{facing:'east'}}]}}),/state/);
  const c=createConstructionProject(opts).checkpoint();c.failures=[{key:'0,64,0',attempts:99,error:''}];assert.throws(()=>createConstructionProject({...opts,checkpoint:c}),/checkpoint/);
  assert.throws(()=>createConstructionProject({...opts,blueprint:{...blueprint(1),air:Array.from({length:4097},(_,x)=>({x,y:70,z:0}))}}),/4096/);
});

test('world scope and member checks reject cross-dimension or foreign work before reads',()=>{
  const f=fixture();for(const change of [{worldId:'other'},{dimension:'minecraft:the_end'},{agent:'Intruder'}])assert.throws(()=>f.project.claim({...f.context('Atlas'),...change,readBlock:()=>{assert.fail('should not read');}}),/scope/);
});

test('read failures and asynchronous readers cannot partly update the observation table',()=>{
  const f=fixture();assert.throws(()=>f.project.claim({...f.context('Atlas'),readBlock:p=>{if(p.x===1)throw new Error('read failed');return {name:'stone'};}}),/read failed/);
  assert.equal(f.project.snapshot().confirmed,0);assert.equal(f.project.snapshot().observedAt,null);
  assert.throws(()=>f.project.claim({...f.context('Atlas'),readBlock:async()=>({name:'air'})}),/synchronous/);
});

test('canceling an in-flight batch prevents its next placement and releases the claim',async()=>{
  const f=fixture(),controller=new AbortController();let entered;
  const started=new Promise(r=>entered=r);let calls=0;
  f.clients[0].execute=async(a,{signal})=>{calls++;entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  const pending=runConstructionBatch(f.clients[0],f.project,{signal:controller.signal});await started;controller.abort(new Error('user pause'));
  await assert.rejects(pending,/user pause/);assert.equal(calls,1);assert.equal(f.project.snapshot().leases.length,0);assert.equal(f.project.snapshot().cells[0].attempts,0);
});

test('losing the project lease aborts the physical executor',async()=>{
  const f=fixture({leaseMs:300});let entered;const started=new Promise(r=>entered=r);
  // Real clients have a live socket. The mock needs a referenced, abortable handle too;
  // a pending Promise plus unreferenced lease/AbortSignal timers cannot keep Node alive.
  f.clients[0].execute=async(a,{signal})=>{entered();await delay(2000,undefined,{signal});};
  const pending=runConstructionBatch(f.clients[0],f.project,{signal:AbortSignal.timeout(2000)});await started;f.advance(301);
  await assert.rejects(pending,/lease expired/);assert.equal(f.project.snapshot().leases.length,0);
});

test('external changes invalidate previous observed completion on the next claim',async()=>{
  const f=fixture({blueprint:blueprint(1)});await runConstructionBatch(f.clients[0],f.project);f.blocks.clear();
  assert.equal(f.project.claim(f.context('Atlas')).status,'claimed');assert.equal(f.project.snapshot().confirmed,0);
});

test('Creative uses ordinary creative inventory and place actions rather than world commands',async()=>{
  const f=fixture({blueprint:blueprint(1)}),c=f.clients[0];c.state.gameMode='creative';c.inventory.count=()=>0;
  const original=c.execute;c.execute=async(a,o)=>a.skill==='creativeTake'?(f.calls.push(a),{}):original(a,o);
  const r=await runConstructionBatch(c,f.project);assert.equal(r.status,'completed');assert.deepEqual(f.calls.map(a=>a.skill),['creativeTake','place']);
});

test('project snapshots are detached copies and closed projects cannot accept new work',()=>{
  const f=fixture(),j=f.project.claim(f.context('Atlas'));const s=f.project.snapshot();s.cells[0].position.x=999;s.leases[0].token='bad';
  assert.equal(f.project.snapshot().cells[0].position.x,0);assert.equal(f.project.snapshot().leases[0].token,j.lease.token);
  f.project.close();assert.equal(f.project.snapshot().status,'closed');assert.equal(f.project.snapshot().leases.length,0);assert.throws(()=>f.project.claim(f.context('Atlas')),/closed/);
});

test('large project diagnostics are capped and full failure checkpoints round-trip within their byte budget',()=>{
  const opts={id:'large',worldId,dimension,agents:names,blueprint:blueprint(4096)},p=createConstructionProject(opts),saved=p.checkpoint();
  saved.failures=opts.blueprint.cells.map(c=>({key:blockKey(c),attempts:1,error:'\u0001'.repeat(120)}));
  const restored=createConstructionProject({...opts,checkpoint:saved});assert.equal(restored.snapshot().cells.length,128);assert.equal(restored.snapshot().truncated,true);
  assert.equal(restored.snapshot({maxCells:4096}).cells.length,4096);assert.equal(restored.checkpoint().failures.length,4096);assert.equal(restored.snapshot({maxCells:0}).total,4096);
});

test('unobserved interior constraints block placement and composite cells require observed completion',async()=>{
  const opts={schemaVersion:1,cells:blueprint(1).cells,dependent:[{x:0,y:65,z:0,block:'minecraft:stone'}],air:[{x:1,y:65,z:0}]},f=fixture({blueprint:opts});
  assert.equal(f.project.claim({...f.context('Atlas'),readBlock:p=>p.x===1?null:f.readBlock(p)}).status,'blocked');
  const first=await runConstructionBatch(f.clients[0],f.project);assert.equal(first.confirmed,1);assert.notEqual(first.status,'completed');
  f.blocks.set('0,65,0',{name:'stone',boundingBox:'block'});assert.equal(f.project.claim(f.context('Atlas')).status,'completed');
});

test('manager team batches share one project and expose observed progress',async()=>{
  const f=fixture();const manager=createAgentManager({names,count:3,worldId,cooperation:false,createClient:({username})=>f.clients[names.indexOf(username)]});
  try{
    manager.entries.get('Atlas').schematic={cells:blueprint().cells.map(c=>({...c,y:0,properties:{}})),blockCount:6,unsupportedStates:0};
    const result=await manager.execute('Atlas','buildTogether',{origin:{x:0,y:64,z:0},maxActions:8});
    assert.equal(result.project.status,'completed');assert.equal(manager.snapshot().construction[0].confirmed,6);assert.equal(new Set(f.calls.map(c=>c.agent)).size,3);
    assert.ok(manager.snapshot().agents.every(a=>!a.busy));
    await assert.rejects(manager.execute('Atlas','buildTogether',{origin:{x:9,y:64,z:0}}),/different/);
  }finally{await manager.close();}
});

test('pausing any manager team member cancels the whole batch without launching more cells',async()=>{
  const f=fixture(),manager=createAgentManager({names,count:3,worldId,cooperation:false,createClient:({username})=>f.clients[names.indexOf(username)]});let entered;const started=new Promise(r=>entered=r);
  for(const c of f.clients)c.execute=async(a,{signal})=>{f.calls.push(a);entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  try{
    manager.entries.get('Atlas').schematic={cells:blueprint().cells.map(c=>({...c,y:0,properties:{}})),blockCount:6,unsupportedStates:0};
    const pending=manager.execute('Atlas','buildTogether',{origin:{x:0,y:64,z:0}});await started;
    await manager.execute('Blake','pause');await assert.rejects(pending,/interrupted/);
    assert.equal(f.calls.length,3);assert.equal(manager.snapshot().construction[0].leases.length,0);assert.ok(manager.snapshot().agents.every(a=>!a.busy));
  }finally{await manager.close();}
});

test('pausing a legacy single-agent schematic batch cancels the batch rather than only its current action',async()=>{
  const f=fixture(),manager=createAgentManager({names:['Atlas'],count:1,worldId,cooperation:false,createClient:()=>f.clients[0]});let entered;const started=new Promise(r=>entered=r);let calls=0;
  f.clients[0].execute=async(a,{signal})=>{calls++;entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  try{
    manager.entries.get('Atlas').schematic={cells:blueprint().cells.map(c=>({...c,y:0,properties:{}})),blockCount:6,unsupportedStates:0};
    const pending=manager.execute('Atlas','buildSchematic',{origin:{x:0,y:64,z:0}});await started;await manager.execute('Atlas','pause');
    await assert.rejects(pending,/paused/);assert.equal(calls,1);assert.equal(manager.entries.get('Atlas').busy,false);
  }finally{await manager.close();}
});

test('importing another schematic clears the default project only when management is idle',async()=>{
  const f=fixture(),manager=createAgentManager({names:['Atlas'],count:1,worldId,cooperation:false,createClient:()=>f.clients[0]});
  const source=nbt.writeUncompressed(nbt.comp({size:nbt.list(nbt.int([1,1,1])),palette:nbt.list(nbt.comp([{Name:nbt.string('minecraft:stone')}])),blocks:nbt.list(nbt.comp([{pos:nbt.list(nbt.int([0,0,0])),state:nbt.int(0)}]))}));
  try{
    manager.importSchematic('Atlas',source,'first.nbt');await manager.execute('Atlas','buildTogether',{origin:{x:0,y:64,z:0}});
    assert.equal(manager.snapshot().construction.length,1);const e=manager.entries.get('Atlas');e.busy=true;
    assert.throws(()=>manager.importSchematic('Atlas',source,'second.nbt'),/Pause/);assert.equal(manager.snapshot().construction.length,1);
    e.busy=false;manager.importSchematic('Atlas',source,'second.nbt');assert.equal(manager.snapshot().construction.length,0);
    const r=await manager.execute('Atlas','buildTogether',{origin:{x:1,y:64,z:0}});assert.equal(r.project.status,'completed');
  }finally{await manager.close();}
});
