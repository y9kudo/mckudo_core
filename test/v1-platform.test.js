import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createWorkerSupervisor} from '../src/intelligence.js';
import {createDQN,openWorldStore,createReplayWriter,readReplay,trainOffline,createWatchdog,createRecoveryPolicy,createTelemetry,createTeamBlackboard,assignRoles,evaluateExchange} from '../src/intelligence.js';

test('SQLite persists across reopen, scopes worlds and tombstones prevent stale resurrection',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mckudo-map-')),options={path:join(dir,'map.sqlite'),worldId:'seed-one',serverId:'local',minecraftVersion:'1.21.1',clock:()=>10000};let store;
  try{store=await openWorldStore(options);const p={x:1,y:64,z:1},batch=(name,t)=>store.observe({dimension:'minecraft:overworld',blocks:[{position:p,name}],agent:'Alice',observedAt:t});batch('minecraft:stone',9000);store.close();store=await openWorldStore(options);const query={dimension:'minecraft:overworld',near:p,radius:8};assert.equal(store.query(query)[0].name,'minecraft:stone');assert.equal(store.query(query)[0].requiresRevalidation,true);batch('minecraft:air',9500);batch('minecraft:stone',9200);assert.equal(store.query(query).length,0);batch('minecraft:diamond_ore',9600);assert.equal(store.query({...query,names:['minecraft:diamond_ore']}).length,1);assert.equal(store.query({...query,dimension:'minecraft:the_nether'}).length,0);store.close();store=null;await assert.rejects(openWorldStore({...options,worldId:'other'}),/identity/);
  }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});

test('Replay round trip feeds offline conservative DQN and rejects a mismatched feature schema',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mckudo-replay-')),path=join(dir,'episodes.ndjson');let writer;
  try{writer=await createReplayWriter({path,featureSchema:'test-v1',actionSchema:'two-v1'});for(let i=0;i<32;i++)await writer.append({observation:[i%2],action:i%2,reward:1,nextObservation:[0],terminated:true,truncated:false});await writer.close();const rows=[];for await(const t of readReplay(path,{featureSchema:'test-v1'}))rows.push(t);assert.equal(rows.length,32);const p=createDQN({inputs:1,actions:2,conservativeWeight:.1});assert.equal((await trainOffline(p,path,{steps:2})).records,32);assert.equal(p.snapshot().updates,2);await assert.rejects(async()=>{for await(const row of readReplay(path,{featureSchema:'different'}))void row;},/schema/);
  }finally{await writer?.close();await rm(dir,{recursive:true,force:true});}
});

test('Watchdog restarts a missed heartbeat once and circuit-breaks a repeated hang',async()=>{
  let now=0,calls=0;const w=createWatchdog({timeoutMs:10,restartWindowMs:1000,maxRestarts:1,clock:()=>now,restart:async()=>{calls++;}});assert.equal((await w.check()).status,'healthy');now=11;assert.equal((await w.check()).status,'restarted');assert.equal(calls,1);now=22;assert.equal((await w.check()).status,'blocked');assert.equal(calls,1);w.close();
});

test('Parent supervisor terminates an actually blocked worker and stops a restart storm',async()=>{
  const s=createWorkerSupervisor({module:new URL('./fixtures/v1-watchdog-worker.mjs',import.meta.url),workerData:{block:true},timeoutMs:100,maxRestarts:1,restartWindowMs:10000,memoryMb:32});
  try{const result=await Promise.race([once(s.events,'blocked'),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Supervisor did not detect the hang')),3000);t.unref();})]);assert.ok(result[0].reason);assert.equal(s.snapshot().status,'blocked');assert.equal(s.snapshot().watchdog.restarts,1);}finally{await s.close();}
});

test('Death recovery requests one respawn and revalidates goals before resuming',()=>{
  let now=0;const p=createRecoveryPolicy({clock:()=>now,respawnDelayMs:10,maxDeaths:1}),dead={dimension:'minecraft:the_nether',self:{position:{x:0,y:64,z:0},health:0}};assert.equal(p.update(dead).phase,'dead');now=11;assert.equal(p.update(dead).action.type,'respawn');assert.equal(p.update(dead).action,null);const rebuilt=p.update({...dead,self:{health:20}});assert.equal(rebuilt.action.revalidateGoals,true);assert.equal(rebuilt.action.deathDimension,'minecraft:the_nether');p.resume();assert.equal(p.update(dead).phase,'blocked');
});

test('Telemetry exports Prometheus counters, bounded traces and optional OTel spans',async()=>{
  let now=0;const statuses=[],telemetry=createTelemetry({capacity:8,clock:()=>now,tracer:{startActiveSpan:async(name,fn)=>fn({setStatus:s=>statuses.push(s.code),recordException:()=>{},end:()=>{}})}});await telemetry.trace('decision',async()=>{now=2;});await assert.rejects(telemetry.trace('decision',async()=>{throw new Error('failed');}));assert.match(telemetry.prometheus(),/decision_count 2/);assert.match(telemetry.prometheus(),/decision_errors_total 1/);assert.deepEqual(statuses,[1,2]);assert.equal(telemetry.snapshot().spans.length,2);
});

test('Team protocol deduplicates sequences, expires records and assigns different specialist roles',()=>{
  let now=0;const t=createTeamBlackboard({worldId:'shared',clock:()=>now,ttlMs:10});assert.equal(t.publish({id:'danger',agent:'Alice',type:'danger',payload:{mob:'zombie'}}),true);assert.equal(t.publish({id:'danger',agent:'Alice',type:'danger',payload:{}}),false);assert.equal(t.read({excludeAgent:'Alice'}).length,0);now=11;assert.equal(t.read().length,0);
  const roles=assignRoles([{id:'Alice',skills:{mining:1}},{id:'Bob',skills:{building:1}}],[{id:'miner',skills:{mining:1}},{id:'builder',skills:{building:1}}]);assert.equal(roles.find(r=>r.agent==='Alice').role,'miner');assert.equal(roles.find(r=>r.agent==='Bob').role,'builder');
});

test('Multi-item exchange requires positive gains for both parties and respects reserves',()=>{
  const left={inventory:{wood:8},reserves:{wood:2},values:{wood:1,iron:10}},right={inventory:{iron:2},values:{wood:2,iron:1}},deal={left,right,giveLeft:{wood:4},giveRight:{iron:1}};assert.equal(evaluateExchange(deal).accepted,true);assert.equal(evaluateExchange({...deal,giveLeft:{wood:8}}).accepted,false);
});
