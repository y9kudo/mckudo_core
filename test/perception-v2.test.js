import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerceptionTracker,semanticCategories} from '../src/perception-tracker.js';
import {createEntitySensor,selectPerceivedEntities} from '../src/entity-perception.js';
import {createOMAdapter} from '../adapters/omconnect.js';
import {OMConnect} from '../omconnect/index.js';
import {createCombatReactor} from '../src/combat.js';
import {createMinecraftBrain} from '../src/minecraft-brain.js';

const dim='minecraft:overworld',signal=new AbortController().signal;
const entity=(id,name='cow',x=2)=>({id:String(id),name,kind:name==='player'?'player':'entity',position:{x,y:64,z:0},velocity:{x:0,y:0,z:0},metadata:{}});
const fixture=()=>{
  const c=new OMConnect({username:'PerceptionTest'});Object.assign(c.state,{position:{x:0,y:64,z:0},dimension:dim,health:20,food:20,status:'ready'});
  const block=name=>c.world.Block.fromStateId(c.registry.blocksByName[name].defaultState,0);
  c.world.blockAt=()=>block('air');return {c,block};
};

test('semantic evidence supports overlapping classes and bounded coalescing without inventing live blocks',()=>{
  assert.deepEqual(semanticCategories('minecraft:birch_leaves'),['tree','leaves']);
  assert.deepEqual(semanticCategories('deepslate_iron_ore'),['ores','deepslate_ores']);
  let now=0;const tracker=createPerceptionTracker({maxEntities:2,maxChanges:3,clock:()=>now});tracker.setScope(dim);
  for(let i=0;i<20;i++)tracker.observeEntity(entity('a','cow',i),{dimension:dim});
  assert.equal(tracker.snapshot().trackedEntities,1);assert.equal(tracker.snapshot().coalesced,19);
  tracker.observeBlock({position:{x:1,y:64,z:0},name:'birch_log'},dim);
  assert.deepEqual(tracker.snapshot().changes.at(-1).categories,['tree','logs']);assert.equal(tracker.evidence('a').confidence,1);
  now=6000;assert.equal(tracker.evidence('a').confidence,.5);tracker.forgetEntity('a');assert.equal(tracker.evidence('a').confidence,0);
  for(let i=0;i<10;i++)tracker.observeEntity(entity(i),{dimension:dim});
  assert.equal(tracker.snapshot().trackedEntities,2);assert.equal(tracker.snapshot().changes.length,3);assert.ok(tracker.snapshot().dropped>0);
  tracker.setScope('minecraft:the_nether');assert.equal(tracker.snapshot().trackedEntities,0);assert.equal(tracker.snapshot({limit:0}).changes.length,0);
  const snapshot=tracker.snapshot();snapshot.changes[0].type='bad';assert.notEqual(tracker.snapshot().changes[0].type,'bad');
});

test('bounded entity selection retains distant incoming projectiles and hostiles amid hundreds of nearby drops',()=>{
  const drops=Array.from({length:400},(_,i)=>entity(i,'item',.1+i/1000)),arrow={...entity('arrow','arrow',20),velocity:{x:-1,y:0,z:0}},zombie=entity('zombie','zombie',6);
  const selected=selectPerceivedEntities([...drops,arrow,zombie],{position:{x:0,y:64,z:0},limit:128,dimension:dim});
  assert.equal(selected.entities[0].id,'arrow');assert.ok(selected.entities.some(e=>e.id==='zombie'));assert.equal(selected.entities.length,128);assert.equal(selected.omitted,274);
  const away={...arrow,id:'away',velocity:{x:1,y:0,z:0}};
  assert.equal(selectPerceivedEntities([away,zombie],{position:{x:0,y:64,z:0},limit:1,dimension:dim}).entities[0].id,'zombie');
});

test('bounded entity heap matches an independent full-sort oracle across shuffled categories',()=>{
  const values=Array.from({length:513},(_,i)=>entity(i,i%7===0?'item':i%5===0?'player':i%3===0?'zombie':'cow',1+(i*17%100)));
  const tier=e=>e.name==='zombie'?3:e.kind==='player'?4:e.name==='item'?6:5;
  const expected=[...values].sort((a,b)=>tier(a)-tier(b)||a.position.x-b.position.x||a.id.localeCompare(b.id)).slice(0,128).map(e=>e.id);
  assert.deepEqual(selectPerceivedEntities(values,{position:{x:0,y:64,z:0},limit:128,dimension:dim}).entities.map(e=>e.id),expected);
});

test('entity visibility has a hard ray budget, exact-pose cache and revision invalidation',()=>{
  const {c,block}=fixture();for(let i=0;i<40;i++)c.entities.set(i,entity(i,'cow',2+i/100));
  const sensor=createEntitySensor(c,{maxRays:4});const first=sensor.read();
  assert.equal(first.metrics.rays,4);assert.equal(first.entities.filter(e=>e.visibilityReason==='budget').length,36);
  const next=sensor.read();assert.equal(next.metrics.cacheHits,4);assert.equal(next.metrics.rays,4);
  c.world.revision++;c.world.blockAt=p=>p.x>=1?block('stone'):block('air');
  const changed=sensor.read();assert.equal(changed.metrics.cacheHits,0);assert.equal(changed.entities[0].visible,false);assert.equal(changed.entities[0].visibilityReason,'blocked');
  c.world.revision++;c.world.blockAt=()=>null;const unknown=sensor.read().entities[0];assert.equal(unknown.visible,null);assert.equal(unknown.visibilityReason,'unloaded');
});

test('urgent observations include fresh weapons/ammunition so equipped agents do not become falsely unarmed',async()=>{
  const {c}=fixture(),adapter=createOMAdapter(c,{trackedBlocks:[]});c.entities.set(1,entity(1,'zombie',6));
  c.inventory.slots[36]={name:'iron_sword',item:'minecraft:iron_sword',count:1};
  c.inventory.slots[37]={name:'bow',item:'minecraft:bow',count:1};c.inventory.slots[38]={name:'arrow',item:'minecraft:arrow',count:12};
  const first=await adapter.observeThreats({signal});assert.equal(first.inventory['minecraft:iron_sword'],1);assert.equal(first.inventory['minecraft:arrow'],12);
  const decision=createCombatReactor({pathRetreat:true}).react(first);assert.equal(decision.action.skill,'combat');
  c.inventory.slots[36]=null;c.inventory.slots[37]=null;c.inventory.slots[38]=null;
  assert.equal(createCombatReactor({pathRetreat:true}).react(await adapter.observeThreats({signal})).action.skill,'evade');
  adapter.dispose();await c.close();
});

test('adapter event metadata follows movement, destruction, scope changes and disposal without duplicate listeners',async()=>{
  const {c}=fixture(),adapter=createOMAdapter(c,{trackedBlocks:[]});await adapter.observeThreats({signal});
  const count=c.listenerCount('entity'),e=entity(1,'player',3);c.entities.set(1,e);c.emit('entity',e);
  assert.equal(adapter.perception.evidence('1').source,'packet');assert.equal(adapter.perception.snapshot().changes.at(-1).id,'1');
  c.entities.delete(1);c.emit('entityGone',e);assert.equal(adapter.perception.evidence('1').confidence,0);
  c.state.dimension='minecraft:the_nether';c.emit('respawnPacket');assert.equal(adapter.perception.snapshot().dimension,c.state.dimension);
  adapter.dispose();assert.equal(c.listenerCount('entity'),count-1);
  await adapter.observeThreats({signal});assert.equal(c.listenerCount('entity'),count);
  adapter.dispose();await c.close();
});

test('irrelevant block edits reuse resource scans; tracked edits and nearby chunk changes invalidate them',async()=>{
  const {c,block}=fixture();let scans=0;
  c.world.findBlocks=async()=>{scans++;return {blocks:[],revision:c.world.revision,truncated:false};};
  const adapter=createOMAdapter(c,{trackedBlocks:['birch_log'],searchRadius:16});
  await adapter.observe({signal});const initial=scans;
  c.world.blockAt=()=>block('air');c.world.revision++;
  c.world.emit('blockUpdate',{position:{x:1,y:64,z:0},previous:c.registry.blocksByName.stone.defaultState,stateId:0});
  await adapter.observe({signal});assert.equal(scans,initial);
  c.world.revision++;c.world.emit('blockUpdate',{position:{x:1,y:64,z:0},previous:c.registry.blocksByName.birch_log.defaultState,stateId:0});
  await adapter.observe({signal});assert.ok(scans>initial);const afterTracked=scans;
  c.world.revision++;c.world.emit('chunkLoad',{x:100,z:100});await adapter.observe({signal});assert.equal(scans,afterTracked);
  c.world.revision++;c.world.emit('chunkUnload',{x:0,z:0});await adapter.observe({signal});assert.ok(scans>afterTracked);
  adapter.dispose();await c.close();
});

test('visibility beyond sixteen blocks is available only through an observed clear corridor',async()=>{
  const {c}=fixture(),adapter=createOMAdapter(c,{trackedBlocks:[]});c.entities.set(1,entity(1,'skeleton',30));
  const view=await adapter.observeThreats({signal});assert.equal(view.entities[0].visible,true);assert.equal(view.perception.visibilityDistance,48);
  adapter.dispose();await c.close();
});

test('combat briefly retains an admissible target and immediately honors a close creeper or fresh attributed hit',()=>{
  let now=1000;const r=createCombatReactor({clock:()=>now}),a={...entity('a','zombie',3),hostile:true,visible:true},b={...entity('b','zombie',3.2),hostile:true,visible:true};
  const o={dimension:dim,self:{position:{x:0,y:64,z:0},health:20},entities:[a,b],combat:{attackers:[]}};
  assert.equal(r.react(o).action.args.entityId,'a');b.position.x=2.9;assert.equal(r.react(o).action.args.entityId,'a');
  o.combat.attackers=[{entityId:'b',hits:1,lastHitAt:1001}];now=1001;assert.equal(r.react(o).action.args.entityId,'b');
  o.entities.push({...entity('c','creeper',4),hostile:true,visible:true});assert.equal(r.react(o).action.args.entityId,'c');
});

test('target commitment expires and never authorizes attacking a neutral player',()=>{
  let now=1000;const r=createCombatReactor({clock:()=>now,attackPlayers:true}),a={...entity('a','zombie',3),hostile:true,visible:true},b={...entity('b','zombie',4),hostile:true,visible:true},p=entity('p','player',.5);
  const o={dimension:dim,self:{position:{x:0,y:64,z:0},health:20},entities:[a,b,p]};
  assert.equal(r.react(o).action.args.entityId,'a');b.position.x=2.8;now+=601;assert.equal(r.react(o).action.args.entityId,'b');
  o.entities=[p];assert.equal(r.react(o).action,null);
});
