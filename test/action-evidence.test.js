import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {createActionEvidenceMemory, createCore, createSurvivalReactor, catalogFromMinecraftData} from '../overmindmc.js';
import {planRoute, OMActionError, blockEvidenceValue, WorldRecipeBook} from '../omconnect/index.js';

const air={name:'air',boundingBox:'empty',shapes:[]};
const stone={name:'stone',stateId:1,boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const slab={name:'stone_slab',stateId:2,boundingBox:'block',shapes:[[0,0,0,1,.5,1]]};
const position={x:0,y:64,z:0},goal={x:5,y:64,z:0};
const action={skill:'navigate',args:goal};
const dimension='minecraft:overworld';
const query={agentId:'Avery',dimension,action};
const certificate=()=>planRoute({start:position,goal,getBlock:p=>p.y<64?slab:air}).failure;
const reader=facts=>fact=>facts[fact];

test('native failure certificate names the start preconditions and distinguishes unknown chunks',()=>{
  const failure=certificate();assert.equal(failure.code,'START_UNSUPPORTED');
  assert.equal(failure.evidence.complete,true);assert.equal(failure.evidence.facts['block:0,63,0'],blockEvidenceValue(slab));
  const unknown=planRoute({start:position,goal,getBlock:()=>null}).failure;
  assert.equal(unknown.code,'START_UNSUPPORTED');assert.equal(unknown.evidence.complete,false);
  assert.equal(planRoute({start:position,goal,getBlock:p=>p.y<64?stone:air,maxNodes:1}).failure.code,'SEARCH_BUDGET');
});

test('one verified start failure prevents a peer from repeating it toward another destination',()=>{
  const memory=createActionEvidenceMemory({worldId:'trial'}),failure=certificate();
  memory.record({...query,failure});
  const peer=memory.assess({...query,agentId:'Blake',action:{skill:'navigate',args:{x:9,y:64,z:1}},readFact:reader(failure.evidence.facts)});
  assert.equal(peer.blocked,true);assert.equal(peer.sourceAgent,'Avery');assert.equal(peer.mode,'condition');
  assert.equal(memory.snapshot().sharedAvoided,1);
  assert.equal(memory.assess({...query,action:{skill:'dig',args:goal},readFact:reader(failure.evidence.facts)}).blocked,false);
});

test('changed support immediately reopens the action while unrelated world revisions do not',()=>{
  let now=0;const memory=createActionEvidenceMemory({worldId:'trial',clock:()=>now}),failure=certificate();
  memory.record({...query,failure});now=1000000;
  const same=reader({...failure.evidence.facts,'worldRevision':999999});
  assert.equal(memory.assess({...query,readFact:same}).blocked,true);
  const changed=memory.assess({...query,readFact:reader({...failure.evidence.facts,'block:0,63,0':blockEvidenceValue(stone)})});
  assert.equal(changed.blocked,false);assert.deepEqual(changed.changedFacts,['block:0,63,0']);
  assert.equal(memory.assess({...query,readFact:reader(failure.evidence.facts)}).blocked,true,'another peer may still observe the original state');
});

test('a missing observation, different dimension or different movement mode never reuses the veto',()=>{
  const memory=createActionEvidenceMemory({worldId:'trial'}),failure=certificate();memory.record({...query,failure});
  const readFact=reader(failure.evidence.facts);
  assert.equal(memory.assess({...query,readFact:()=>null}).blocked,false);
  assert.equal(memory.assess({...query,dimension:'minecraft:the_end',readFact}).blocked,false);
  assert.equal(memory.assess({...query,readFact:reader({...failure.evidence.facts,navigationMode:'creative-flight'})}).blocked,false);
});

test('a timeout is agent-local and expires instead of becoming a shared permanent obstacle',()=>{
  let now=0;const memory=createActionEvidenceMemory({worldId:'trial',clock:()=>now});
  memory.record({...query,failure:{code:'STEP_STALLED'}});
  const input={...query,readFact:()=>null};
  assert.equal(memory.assess(input).blocked,true);
  assert.equal(memory.assess({...input,agentId:'Blake'}).blocked,false);
  now=2000;assert.equal(memory.assess(input).blocked,false);
  memory.record({...query,failure:{code:'STEP_STALLED'}});
  now=4000;assert.equal(memory.assess(input).blocked,true);
  now=6000;assert.equal(memory.assess(input).blocked,false);
});

test('a code without known complete evidence gets a timer; journal size and copies are bounded',()=>{
  let now=0;const memory=createActionEvidenceMemory({worldId:'trial',maxEntries:2,clock:()=>now});
  for(let x=0;x<3;x++)memory.record({...query,action:{skill:'navigate',args:{x,y:64,z:0}},failure:{code:'START_UNSUPPORTED',evidence:{complete:true,facts:{position:'0,64,0','block:0,63,0':null}}}});
  const snapshot=memory.snapshot();assert.equal(snapshot.entries.length,2);
  assert.ok(snapshot.entries.every(e=>e.mode==='timer'));snapshot.entries.length=0;assert.equal(memory.snapshot().entries.length,2);
  now=2001;assert.equal(memory.assess({...query,action:{skill:'navigate',args:{x:2,y:64,z:0}},readFact:()=>null}).blocked,false);
  assert.throws(()=>createActionEvidenceMemory({worldId:''}));
});

test('structured transport errors survive core action events and persisted history',async()=>{
  const failure=certificate();
  const core=createCore({config:{schemaVersion:1,name:'Avery',worldId:'trial',rules:[{id:'walk',action}]},adapter:{
    describe:()=>({protocolVersion:1,kind:'test',skills:['navigate']}),
    observe:async()=>({dimension,self:{position,health:20,food:20}}),
    execute:async()=>{throw new OMActionError(failure.code,'Start precondition failed',failure.evidence);}
  }});
  let received;core.once('action:finish',e=>{received=e;});
  const state=await core.tick();assert.deepEqual(state.lastResult.failure,failure);assert.deepEqual(received.failure,failure);
  assert.equal(state.history.at(-1).failure.code,'START_UNSUPPORTED');await core.stop();
});

test('survival uses the shared memory and resumes after observed support repair',()=>{
  const registry=minecraftData('1.21.1'),catalog=catalogFromMinecraftData(registry);
  let support=stone,now=0;
  const world={blockAt:p=>p.y<64?support:air};
  const memory=createActionEvidenceMemory({worldId:'trial',clock:()=>now});
  const client={world,state:{position},options:{username:'Avery'}};
  const reactor=createSurvivalReactor({client,catalog,actionEvidence:memory,targets:{'#logs':1},clock:()=>now,
    explorationPlanner:{poll:()=>({status:'planned',target:goal,reason:'explore'}),invalidate(){}}});
  const observation={dimension,self:{position,health:20,food:20},inventory:{},world:{sampledBlocks:[]},drops:[]};
  const first=reactor.react(observation);assert.equal(first.action.skill,'navigate');
  support=slab;
  const failure=planRoute({start:position,goal,getBlock:world.blockAt}).failure;
  reactor.recordResult({outcome:'failure',detail:"Start cell is not confirmed clear and supported.",failure},first.action);
  now=300000;assert.equal(reactor.react(observation).action,null);
  support=stone;assert.deepEqual(reactor.react(observation).action,first.action);
});

test('server recipe ingestion replaces an earlier version-catalog fallback',()=>{
  const book=new WorldRecipeBook(minecraftData('1.21.1'));
  book.useVersionCatalog(10);assert.ok(book.recipesFor('crafting_table').length);
  book.ingest({recipes:[]});assert.equal(book.snapshot().source,'server');assert.deepEqual(book.recipesFor('crafting_table'),[]);
});

test('the full core honors evidence repair immediately without a second independent cooldown',async()=>{
  const registry=minecraftData('1.21.1'),catalog=catalogFromMinecraftData(registry);
  const memory=createActionEvidenceMemory({worldId:'trial',clock:()=>0});
  let support=slab,calls=0;
  const world={blockAt:p=>p.y<64?support:air};
  const client={world,state:{position},options:{username:'Avery'}};
  const reactor=createSurvivalReactor({client,catalog,actionEvidence:memory,targets:{'#logs':1},clock:()=>0,
    explorationPlanner:{poll:()=>({status:'planned',target:goal,reason:'explore'}),invalidate(){}}});
  const core=createCore({clock:()=>0,config:{schemaVersion:4,name:'Avery',worldId:'trial'},reactors:[reactor],adapter:{
    describe:()=>({protocolVersion:1,kind:'test',skills:['navigate']}),
    observe:async()=>({dimension,self:{position,health:20,food:20},inventory:{},world:{sampledBlocks:[]},drops:[]}),
    execute:async()=>{calls++;const route=planRoute({start:position,goal,getBlock:world.blockAt});if(route.failure)throw new OMActionError(route.failure.code,route.reason,route.failure.evidence);return {ok:true};}
  }});
  reactor.attach(core);
  await core.tick();assert.equal(calls,1);
  await core.tick();assert.equal(calls,1,'unchanged evidence must suppress the retry');
  support=stone;await core.tick();assert.equal(calls,2,'support repair must reopen the actual executor at the same clock time');
  assert.equal(core.snapshot().lastResult.outcome,'success');await core.stop();
});
