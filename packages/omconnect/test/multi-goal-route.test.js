import test from 'node:test';
import assert from 'node:assert/strict';
import {planRoute,planRouteToAny,planRouteToAnyAsync,OMVectorize} from '../index.js';
const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
const start={x:0,y:1,z:0},goals=[{x:4,y:1,z:0},{x:0,y:1,z:7}];
const world=p=>p.y<1||p.x===3&&Math.abs(p.z)<=4&&p.y<4?stone:air;
test('one frontier selects the cheapest reachable approach rather than the nearest coordinate',()=>{
  const options={start,getBlock:world,maxNodes:5000,maxDistance:20};
  const individual=goals.map(goal=>planRoute({...options,goal})),combined=planRouteToAny({...options,goals});
  assert.equal(combined.status,'planned');assert.deepEqual(combined.selectedGoal,goals[1]);
  assert.equal(combined.cost,Math.min(...individual.map(p=>p.cost)));assert.equal(combined.goalCount,2);
  assert.ok(combined.visited<individual.reduce((n,p)=>n+p.visited,0));
  assert.deepEqual(goals,[{x:4,y:1,z:0},{x:0,y:1,z:7}]);
});
test('duplicate goals share labels; occupied and unloaded goals cannot win',()=>{
  const valid={x:0,y:1,z:4},blocked={x:1,y:1,z:0};
  const result=planRouteToAny({start,goals:[blocked,valid,valid],getBlock:p=>p.x>1?null:world(p),occupied:p=>p.x===1&&p.z===0,maxNodes:200});
  assert.equal(result.status,'planned');assert.deepEqual(result.selectedGoal,valid);assert.equal(result.goalCount,2);
  const unknown=planRouteToAny({start,goals:[{x:4,y:1,z:0}],getBlock:p=>p.x>1?null:world(p),maxNodes:100,maxDistance:5});assert.equal(unknown.status,'blocked');
});
test('multi-goal search validates limits and honors a single shared budget and cancellation',async()=>{
  for(const list of [[],Array.from({length:129},()=>start),[{x:NaN,y:1,z:0}]])assert.throws(()=>planRouteToAny({start,goals:list,getBlock:world}));
  const limited=planRouteToAny({start,goals,maxNodes:1,getBlock:world});assert.equal(limited.status,'blocked');assert.ok(limited.visited<=1);
  await assert.rejects(planRouteToAnyAsync({start,goals,getBlock:world,signal:AbortSignal.abort(new Error('cancelled'))}),/cancelled/);
});
test('async multi-goal planning rejects changed terrain; OMVectorize exposes the same selected goal',async()=>{
  let revision=0;await assert.rejects(planRouteToAnyAsync({start,goals,getBlock:p=>{revision++;return world(p);}},{getRevision:()=>revision,nodesPerSlice:1}),e=>e.code==='STALE_WORLD');
  const vector=new OMVectorize({getBlock:world});
  const result=await vector.planGroundToAnyAsync({start,goals});assert.deepEqual(result.selectedGoal,goals[1]);assert.deepEqual(vector.planGroundToAny({start,goals}).selectedGoal,goals[1]);
});
