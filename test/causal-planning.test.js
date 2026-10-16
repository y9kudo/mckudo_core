import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlannerContext,createSymbolicPlanner,validatePlan,validateOperators} from '../overmindmc.js';
const op=(id,requires,effects,cost=1)=>({id,action:{skill:'work',args:{}},...(requires?{requires}:{}),effects,cost});
const eq=(fact,value)=>({fact,eq:value});
test('a large operator domain is sliced by causal prerequisites before bounded cost search',async()=>{
  const inventory={wood:0,planks:0,table:0},operators=Array.from({length:1000},(_,i)=>{inventory['noise'+i]=0;return op('noise'+i,undefined,[{fact:'/inventory/noise'+i,add:1}]);});
  operators.push(op('wood',undefined,[{fact:'/inventory/wood',add:1}]),op('planks',{fact:'/inventory/wood',gte:1},[{fact:'/inventory/wood',add:-1},{fact:'/inventory/planks',add:4}]),op('table',{fact:'/inventory/planks',gte:4},[{fact:'/inventory/planks',add:-4},{fact:'/inventory/table',add:1}]));
  const context=buildPlannerContext({observation:{inventory},goal:{id:'table',desired:{fact:'/inventory/table',gte:1}},operators,skills:['work']}),planner=createSymbolicPlanner({maxNodes:32});
  const plan=await planner.plan(context,{signal:new AbortController().signal});
  assert.deepEqual(plan.steps,['wood','planks','table']);validatePlan(plan,context);
  assert.equal(planner.snapshot().operators,1003);assert.equal(planner.snapshot().relevantOperators,3);assert.ok(planner.snapshot().generated<=32);
});
test('cost search preserves alternative producers, stable ties and cheaper indirect plans',async()=>{
  const operators=[op('expensive',undefined,[{fact:'/ready',set:true}],9),op('prepare',undefined,[{fact:'/prepared',set:true}],1),op('finish',eq('/prepared',true),[{fact:'/ready',set:true}],1)];
  const context=buildPlannerContext({observation:{ready:false,prepared:false},goal:{id:'ready',desired:eq('/ready',true)},operators,skills:['work']});
  const planner=createSymbolicPlanner();assert.deepEqual((await planner.plan(context,{signal:new AbortController().signal})).steps,['prepare','finish']);
  const tied={...context,operators:[op('first',undefined,[{fact:'/ready',set:true}]),op('second',undefined,[{fact:'/ready',set:true}])]};
  assert.deepEqual((await planner.plan(tied,{signal:new AbortController().signal})).steps,['first']);
  assert.throws(()=>validateOperators(Array.from({length:2049},(_,i)=>op('x'+i,undefined,[{fact:'/x',add:1}]))));
});
