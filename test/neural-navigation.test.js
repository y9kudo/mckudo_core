import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralNavigator} from '../src/neural-navigation.js';
import {planRoute} from '../packages/kudoconnect/src/navigation.js';
const walk={from:{x:0,y:1,z:0},to:{x:1,y:1,z:0},kind:'walk',dimension:'minecraft:overworld',health:20,food:20};
test('backprop learns different risks, replay persists and foreign-world memory is rejected',()=>{
  const m=createNeuralNavigator({worldId:'a'}),jump={...walk,to:{x:1,y:2,z:0},kind:'jump'};
  for(let i=0;i<150;i++){m.record({...walk,outcome:'success'});m.record({...jump,outcome:'failure'});}
  assert.ok(m.assess(jump).failureProbability>m.assess(walk).failureProbability+.4);
  const restored=createNeuralNavigator({worldId:'a',memory:m.export()});assert.equal(restored.assess(jump).failureProbability,m.assess(jump).failureProbability);
  assert.throws(()=>createNeuralNavigator({worldId:'b',memory:m.export()}),/другого мира/);
  assert.equal(m.record({...walk,outcome:'cancelled'}),false);assert.equal(m.snapshot().samples,300);
});
test('remembered failure routes around a bad cell without admitting void or hazards',()=>{
  const m=createNeuralNavigator({worldId:'a'});m.record({...walk,outcome:'failure'});
  const ground=p=>p.y<1?{name:'stone',boundingBox:'block'}:{name:'air'};
  const route=planRoute({start:walk.from,goal:{x:3,y:1,z:0},getBlock:ground,maxDistance:8,edgeCost:(from,to,kind)=>m.assess({...walk,from,to,kind}).cost});
  assert.equal(route.status,'planned');assert.ok(route.steps.every(s=>s.position.x!==1||s.position.z!==0));
  assert.equal(planRoute({start:walk.from,goal:{x:3,y:1,z:0},getBlock:()=>null,edgeCost:()=>0}).status,'blocked');
});
test('invalid weights, negative costs and duplicate episodes are not accepted',()=>{
  const m=createNeuralNavigator({worldId:'a'});assert.equal(m.record({...walk,id:'a',outcome:'success'}),true);assert.equal(m.record({...walk,id:'a',outcome:'success'}),false);
  const data=m.export();data.weights.w[0][0]=10001;assert.throws(()=>createNeuralNavigator({worldId:'a',memory:data}),/веса/);
});
