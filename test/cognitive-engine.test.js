import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createCognitiveEngine,createCore,createNeuralPlanner,createExperienceModel} from '../overmindmc.js';
import {verifyMinecraftAction} from '../src/action-verification.js';

const observation=()=>({dimension:'minecraft:overworld',self:{health:20,food:20,position:{x:0,y:64,z:0}},inventory:{wood:0,tool:0}});
const choice=(id,priority=10)=>({id,kind:'reactor',priority,action:{skill:'dig',args:{block:id}},blocked:null});
const config={schemaVersion:4,name:'Cognitive',worldId:'cognitive',rules:[]};
const adapter=(state,execute)=>({describe:()=>({protocolVersion:1,skills:['dig','work']}),observe:async()=>structuredClone(state),execute});

test('arbitration keeps hard priorities and emergency order while ranking admissible peers',()=>{
  let calls=0;const engine=createCognitiveEngine({worldId:'cognitive',assess:(o,a)=>{calls++;return {trained:true,cost:a.args.block==='bad'?20:0};}}),o=observation();
  assert.equal(engine.rank(o,[choice('bad'),choice('safe')])[0].id,'safe');
  assert.equal(engine.rank(o,[choice('bad',11),choice('safe',10)])[0].id,'bad');
  calls=0;assert.equal(engine.rank(o,[choice('bad',990),choice('safe',990)])[0].id,'bad');assert.equal(calls,0);
  assert.equal(engine.rank(o,[{...choice('bad',1000),blocked:'unsupported'},choice('safe')])[0].id,'safe');
});

test('ranking bounds assessment work, ignores invalid estimates and gates uncertain costs',()=>{
  let calls=0;const e=createCognitiveEngine({worldId:'cognitive',maxAssessments:2,assess:()=>{calls++;return {trained:true,cost:NaN};}});
  assert.equal(e.rank(observation(),[choice('a'),choice('b'),choice('c')])[0].id,'a');assert.equal(calls,2);assert.match(e.snapshot().ranking[0].error,/Invalid/);
  const uncertain=createCognitiveEngine({worldId:'cognitive',assess:()=>({trained:true,cost:500,uncertainty:.99})});assert.equal(uncertain.rank(observation(),[choice('a'),choice('b')])[0].id,'a');
  assert.equal(uncertain.snapshot().ranking[0].learnedCost,0);
});

test('reflection is scoped, bounded and persisted; cancellation and unverified progress do not train costs',()=>{
  const e=createCognitiveEngine({worldId:'cognitive',maxEntries:16}),o=observation(),bad=choice('bad');
  for(let i=0;i<3;i++)e.record({candidate:bad,before:o,outcome:'failure'});
  assert.equal(e.rank(o,[bad,choice('safe')])[0].id,'safe');
  const changed={...o,inventory:{wood:1,tool:0}};assert.equal(e.rank(changed,[bad,choice('safe')])[0].id,'bad');
  assert.equal(e.record({candidate:bad,before:o,outcome:'cancelled'}),false);assert.equal(e.record({candidate:bad,before:o,outcome:'progress'}),false);
  const copy=e.export(),restored=createCognitiveEngine({worldId:'cognitive',memory:copy});assert.equal(restored.rank(o,[bad,choice('safe')])[0].id,'safe');
  assert.throws(()=>createCognitiveEngine({worldId:'other',memory:copy}),/world/);
  for(let i=0;i<40;i++)e.record({candidate:choice('id'+i),before:o,outcome:'success',verified:true,durationMs:10});assert.equal(e.snapshot().records,16);
});

test('core uses one arbitration layer and exposes the observed decision cycle without overlapping execution',async()=>{
  const state=observation(),ran=[];
  const core=createCore({config,adapter:adapter(state,async a=>{ran.push(a.args.block);state.inventory.wood++;}),cognitive:{assess:(o,a)=>({trained:true,cost:a.args.block==='bad'?30:0})},
    reactors:['bad','safe'].map(id=>({id,apiVersion:1,react:()=>({priority:10,action:choice(id).action,reason:id,expected:{fact:'/inventory/wood',gte:1}})}))});
  const tick=core.tick();assert.equal(core.tick(),tick);await tick;
  assert.deepEqual(ran,['safe']);assert.equal(core.snapshot().lastResult.verification.status,'confirmed');
  assert.deepEqual(core.cognitive.snapshot().journal.filter(r=>r.kind==='phase').map(r=>r.phase),['observe','understand','plan','act','verify','reflect']);
  const saved=core.exportMemory();assert.equal(saved.cognitive.kind,'cognitive-engine');assert.equal(saved.schemaVersion,2);
  const restored=createCore({config:{...config,rules:[{id:'work',action:{skill:'work'}}]},adapter:adapter(state,async()=>{}),cognitive:{},memory:saved});assert.equal(restored.cognitive.snapshot().records,1);
});

test('unconfirmed expected effects fail and unknown prerequisites never dispatch an action',async()=>{
  let calls=0;const state=observation(),reactor={id:'contract',apiVersion:1,react:()=>({action:{skill:'work',args:{}},priority:10,reason:'Need an actual output.',requires:{fact:'/inventory/wood',gte:0},expected:{fact:'/inventory/tool',gte:1}})};
  const core=createCore({config,adapter:adapter(state,async()=>{calls++;return {ok:true};}),reactors:[reactor],cognitive:{}});
  await core.tick();assert.equal(calls,1);assert.equal(core.snapshot().lastResult.outcome,'failure');assert.equal(core.snapshot().lastResult.failure.code,'EFFECT_UNCONFIRMED');assert.equal(core.cognitive.snapshot().phase,'replan');
  const unknown={...reactor,id:'unknown',react:()=>({...reactor.react(),requires:{fact:'/unseen/quantity',gte:0}})};
  const blocked=createCore({config,adapter:adapter(state,async()=>{calls++;}),reactors:[unknown],cognitive:{}});await blocked.tick();assert.equal(calls,1);
});

test('verified intermediate goal effects train the neural planner and experience learner exactly once',async()=>{
  const state=observation(),model=createNeuralPlanner({worldId:'cognitive'}),experience=createExperienceModel({worldId:'cognitive',facts:['/inventory/wood','/inventory/tool'],minEvidence:2});
  const learning={worldId:'cognitive',assess:(...args)=>experience.assess(...args),record:r=>{experience.record(r);model.record(r);}};
  const operators=[{id:'wood',requires:{fact:'/inventory/wood',eq:0},action:{skill:'dig',args:{block:'wood'}},effects:[{fact:'/inventory/wood',add:1}]},{id:'tool',requires:{fact:'/inventory/wood',gte:1},action:{skill:'craft',args:{item:'tool'}},effects:[{fact:'/inventory/tool',set:1}]}];
  const a=adapter(state,async action=>{if(action.skill==='dig')state.inventory.wood++;else state.inventory.tool=1;});a.describe=()=>({protocolVersion:1,skills:['dig','craft']});
  const core=createCore({config:{...config,goals:[{id:'tool',desired:{fact:'/inventory/tool',gte:1}}]},adapter:a,planning:{operators,minIntervalMs:0},learning,cognitive:{}});
  await core.tick();assert.equal(core.snapshot().lastResult.outcome,'progress');assert.equal(core.snapshot().lastResult.verification.status,'confirmed');assert.equal(model.snapshot().samples,1);assert.equal(experience.snapshot().revision,1);
  await core.tick();assert.equal(core.snapshot().brain.goals[0].status,'achieved');assert.equal(model.snapshot().samples,2);
});

test('urgent observations cancel cooperative planning before any stale action starts',async()=>{
  let notify,planning=false,aborted=false,actions=0,threat=false;
  const state=observation(),a=adapter(state,async()=>{actions++;});a.subscribeUrgent=fn=>{notify=fn;return()=>{};};
  const core=createCore({config:{...config,tickIntervalMs:50,goals:[{id:'tool',desired:{fact:'/inventory/tool',gte:1}}]},adapter:a,cognitive:{},
    reactors:[{id:'urgent',apiVersion:1,preempt:true,react:()=>threat?{action:{skill:'work',args:{}},priority:990,reason:'Defense.'}:{action:null,reason:'Safe.'}}],
    planning:{operators:[{id:'make',action:{skill:'work'},effects:[{fact:'/inventory/tool',set:1}]}],planner:{id:'cooperative',apiVersion:1,plan:async(c,{signal})=>{planning=true;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));aborted=true;signal.throwIfAborted();}}}});
  core.start();try{for(let i=0;i<100&&!planning;i++)await delay(5);assert.ok(planning);threat=true;notify();for(let i=0;i<100&&!actions;i++)await delay(5);assert.ok(aborted);assert.ok(actions>0);assert.ok(core.snapshot().history.every(r=>r.rule==='urgent'));}finally{await core.stop();}
});

test('Minecraft verification uses fresh inventory/position and live blocks, never sampled absence as air',()=>{
  const before=observation(),after=observation(),client={world:{blockAt:()=>null}};
  assert.equal(verifyMinecraftAction(client,{skill:'dig',args:{x:1,y:64,z:0,block:'stone'}},{before,after}).status,'unknown');
  client.world.blockAt=()=>({name:'stone'});assert.equal(verifyMinecraftAction(client,{skill:'dig',args:{x:1,y:64,z:0,block:'stone'}},{before,after}).status,'unconfirmed');
  assert.equal(verifyMinecraftAction(client,{skill:'craft',args:{item:'wood'}},{before,after}).status,'unknown');
  before.inventory['minecraft:wood']=0;after.inventory['minecraft:wood']=1;assert.equal(verifyMinecraftAction(client,{skill:'craft',args:{item:'wood'}},{before,after}).status,'confirmed');
  assert.equal(verifyMinecraftAction(client,{skill:'navigate',args:{x:20,y:64,z:0}},{before,after}).status,'unconfirmed');
});

test('transition subscribers receive isolated before/after evidence and session-scoped episode IDs',async()=>{
  const state=observation(),samples=[],core=createCore({config,adapter:adapter(state,async()=>{state.inventory.wood++;}),reactors:[{id:'work',apiVersion:1,react:()=>({action:{skill:'work',args:{}},priority:10,reason:'Observe the result.',expected:{fact:'/inventory/wood',gte:1}})}]});
  core.on('experience:transition',e=>{samples.push(structuredClone(e));e.after.inventory.wood=999;});await core.tick();
  assert.equal(samples.length,1);assert.match(samples[0].episodeId,/^[a-f0-9-]+:1$/);assert.equal(samples[0].before.inventory.wood,0);assert.equal(samples[0].after.inventory.wood,1);assert.equal(samples[0].verified,true);assert.equal(core.snapshot().observation.inventory.wood,1);
});
