import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {buildPlannerContext,validatePlan,repairPlan,createCognitivePlanner,createHTNPlannerAdapter,createMCTSPlannerAdapter,createSymbolicPlanner,createCore} from '../overmindmc.js';
import {createHTNPlanner,createMCTSPlanner} from '../src/intelligence.js';
const signal=()=>new AbortController().signal;
const state=()=>({dimension:'minecraft:overworld',inventory:{wood:0,planks:0,tool:0}});
const operators=[
  {id:'wood-a',cost:1,requires:{fact:'/inventory/wood',eq:0},action:{skill:'dig',args:{source:'a'}},effects:[{fact:'/inventory/wood',add:1}]},
  {id:'wood-b',cost:2,requires:{fact:'/inventory/wood',eq:0},action:{skill:'dig',args:{source:'b'}},effects:[{fact:'/inventory/wood',add:1}]},
  {id:'planks',requires:{fact:'/inventory/wood',gte:1},action:{skill:'craft',args:{item:'planks'}},effects:[{fact:'/inventory/wood',add:-1},{fact:'/inventory/planks',add:4}]},
  {id:'tool',requires:{fact:'/inventory/planks',gte:4},action:{skill:'craft',args:{item:'tool'}},effects:[{fact:'/inventory/planks',add:-4},{fact:'/inventory/tool',set:1}]}
];
const goal={id:'tool',desired:{fact:'/inventory/tool',gte:1}},skills=['dig','craft'];
const context=(observation=state(),ops=operators)=>buildPlannerContext({observation,goal,operators:ops,skills});

test('repair retains a valid tail and connects an alternate resource source without inventing effects',async()=>{
  const c=context(state(),operators.filter(o=>o.id!=='wood-a')),result=await repairPlan(c,['wood-a','planks','tool'],{signal:signal()});
  assert.equal(result.status,'repaired');assert.deepEqual(result.steps,['wood-b','planks','tool']);assert.equal(result.retainedSteps,2);assert.equal(result.connectorSteps,1);validatePlan({steps:result.steps},c);
});

test('repair skips an externally completed prerequisite and never treats unknown inventory as zero',async()=>{
  const o=state();o.inventory.wood=1;const result=await repairPlan(context(o),['wood-a','planks','tool'],{signal:signal()});
  assert.deepEqual(result.steps,['planks','tool']);assert.equal(result.connectorSteps,0);
  const unknown=state();delete unknown.inventory.wood;assert.equal((await repairPlan(context(unknown),['wood-a','planks','tool'],{signal:signal()})).status,'blocked');
});

test('repair obeys its shared node/depth budgets and yields to cancellation',async()=>{
  const c=context(state(),operators.filter(o=>o.id!=='wood-a'));
  const bounded=await repairPlan(c,['wood-a','planks','tool'],{maxNodes:1,signal:signal()});assert.equal(bounded.status,'blocked');assert.equal(bounded.visited,1);assert.equal(bounded.generated,1);
  const abort=new AbortController();setImmediate(()=>abort.abort(new Error('urgent')));await assert.rejects(repairPlan(c,['wood-a','planks','tool'],{signal:abort.signal}),/urgent/);
});

test('repair does not let a cheaper deep prefix hide a feasible shallower connector',async()=>{
  const edge=(id,from,to,cost)=>({id,cost,requires:{fact:'/x',eq:from},action:{skill:'work',args:{id}},effects:[{fact:'/x',set:to}]});
  const ops=[edge('cheap-start',0,1,1),edge('cheap-second',1,2,1),edge('direct',0,2,10),edge('connect',2,3,1),{id:'tail',requires:{fact:'/x',eq:3},action:{skill:'work',args:{id:'tail'}},effects:[{fact:'/done',set:true}]}];
  const c=buildPlannerContext({observation:{x:0,done:false},goal:{id:'done',desired:{fact:'/done',eq:true}},operators:ops,skills:['work']});
  const result=await repairPlan(c,['unavailable','tail'],{maxDepth:2,signal:signal()});assert.equal(result.status,'repaired');assert.deepEqual(result.steps,['direct','connect','tail']);
});

test('core repairs a failed resource branch and retains a reusable plan tail',async()=>{
  let now=1000;const o=state(),actions=[];
  const a={describe:()=>({protocolVersion:1,skills}),observe:async()=>structuredClone(o),execute:async action=>{actions.push(action);if(action.skill==='dig'){if(action.args.source==='a')throw new Error('Obstruction.');o.inventory.wood++;}else if(action.args.item==='planks'){o.inventory.wood--;o.inventory.planks+=4;}else{o.inventory.planks-=4;o.inventory.tool=1;}}};
  const core=createCore({config:{schemaVersion:4,name:'Repair',worldId:'repair',goals:[goal]},adapter:a,cognitive:{},clock:()=>now,planning:{operators,minIntervalMs:0,retryDelayMs:10}});
  await core.tick();assert.equal(core.snapshot().lastResult.outcome,'failure');now+=11;
  await core.tick();assert.equal(actions[1].args.source,'b');assert.equal(core.snapshot().brain.calls,1);assert.equal(core.snapshot().brain.repairs.repaired,1);
  await core.tick();await core.tick();assert.equal(core.snapshot().brain.goals[0].status,'achieved');assert.equal(core.snapshot().brain.calls,1);
});

test('portfolio validates providers, compares learned costs and never executes their code',async()=>{
  const c=context(),a={id:'a',apiVersion:1,plan:async()=>({steps:['wood-a','planks','tool']})},b={id:'b',apiVersion:1,plan:async()=>({steps:['wood-b','planks','tool']})};
  const planner=createCognitivePlanner({planners:[a,b],budgetMs:1000,assess:(o,action)=>({trained:true,cost:action.args.source==='a'?20:0})});
  const result=await planner.plan(c,{signal:signal()});assert.equal(result.steps[0],'wood-b');assert.equal(planner.snapshot().choices.length,2);
  const hostile={id:'bad',apiVersion:1,plan:async copy=>{copy.observation.inventory.tool=100;return {steps:['invented']};}};
  const safe=createCognitivePlanner({planners:[hostile,createSymbolicPlanner()],budgetMs:1000});const good=await safe.plan(c,{signal:signal()});assert.equal(good.steps[0],'wood-a');assert.equal(c.observation.inventory.tool,0);assert.equal(safe.snapshot().rejected.length,1);
});

test('portfolio budget retains an earlier validated candidate and cancellation leaves no concurrent request',async()=>{
  const first={id:'first',apiVersion:1,plan:async()=>({steps:['wood-a','planks','tool']})};
  const slow={id:'slow',apiVersion:1,plan:async(c,{signal})=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}};
  const p=createCognitivePlanner({planners:[first,slow],budgetMs:100});const result=await p.plan(context(),{signal:signal()});assert.equal(result.steps[0],'wood-a');assert.equal(p.snapshot().budgetExpired,true);
  const abort=new AbortController(),q=createCognitivePlanner({planners:[slow],budgetMs:1000}),pending=q.plan(context(),{signal:abort.signal});await delay(10);abort.abort(new Error('cancel portfolio'));await assert.rejects(pending,/cancel portfolio/);assert.equal(q.snapshot().busy,false);
});

test('existing HTN and MCTS can propose only actions that map to validated operators and a complete goal',async()=>{
  const primitives=Object.fromEntries(operators.map(op=>[op.id,{applicable:()=>true,apply:s=>s,action:()=>op.action}]));
  const htn=createHTNPlanner({primitives,methods:{prepare:[{applicable:()=>true,tasks:()=>['wood-b','planks','tool'].map(name=>({name}))}]}});
  const adapter=createHTNPlannerAdapter({planner:htn,tasks:()=>[{name:'prepare'}]});assert.deepEqual((await adapter.plan(context(),{signal:signal()})).steps,['wood-b','planks','tool']);
  const mcts=createMCTSPlanner({model:{actions:()=>[operators[1].action],step:s=>({state:{...s,done:true},reward:1}),terminal:s=>s.done===true},iterations:4,horizon:1,budgetMs:100});
  const m=createMCTSPlannerAdapter({planner:mcts});assert.deepEqual((await m.plan(context(),{signal:signal()})).steps,['wood-b','planks','tool']);
  const invalid=createHTNPlannerAdapter({planner:{plan:()=>({status:'planned',actions:[{skill:'teleport',args:{}}]})},tasks:()=>[]});await assert.rejects(invalid.plan(context(),{signal:signal()}),/operator/);
});
