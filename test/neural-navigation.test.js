import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralNavigator,attachNeuralNavigation} from '../src/neural-navigation.js';
import {EventEmitter} from 'node:events';
import {planRoute} from '../packages/omconnect/src/navigation.js';
const walk={from:{x:0,y:1,z:0},to:{x:1,y:1,z:0},kind:'walk',dimension:'minecraft:overworld',health:20,food:20};
test('backprop learns different risks, replay persists and foreign-world memory is rejected',()=>{
  const m=createNeuralNavigator({worldId:'a'}),jump={...walk,to:{x:1,y:2,z:0},kind:'jump'};
  for(let i=0;i<150;i++){m.record({...walk,outcome:'success'});m.record({...jump,outcome:'failure'});}
  assert.ok(m.assess(jump).failureProbability>m.assess(walk).failureProbability+.4);
  const restored=createNeuralNavigator({worldId:'a',memory:m.export()});assert.equal(restored.assess(jump).failureProbability,m.assess(jump).failureProbability);
  assert.throws(()=>createNeuralNavigator({worldId:'b',memory:m.export()}),/another world/);
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
  const data=m.export();data.weights.w[0][0]=10001;assert.throws(()=>createNeuralNavigator({worldId:'a',memory:data}),/weights/i);
});

test('failure memory belongs to a directed transition, not every entrance to a destination',()=>{
  const m=createNeuralNavigator({worldId:'directed'});m.record({...walk,outcome:'failure'});
  assert.equal(m.assess(walk).rememberedFailures,1);
  assert.equal(m.assess({...walk,from:{x:1,y:1,z:1}}).rememberedFailures,0);
  assert.equal(m.assess({...walk,kind:'jump'}).rememberedFailures,0);
  assert.equal(m.record({...walk,outcome:'failure',failureCode:'OCCUPIED'}),false);
  assert.equal(m.record({...walk,outcome:'failure',failureCode:'SERVER_CORRECTION'}),false);
  assert.equal(m.snapshot().samples,1);
  assert.equal(createNeuralNavigator({worldId:'directed',memory:m.export()}).assess(walk).rememberedFailures,1);
});
test('schema-one memories keep learned weights but discard broad destination bans',()=>{
  const m=createNeuralNavigator({worldId:'migration'});m.record({...walk,outcome:'failure'});
  const old={...m.export(),schemaVersion:1};old.failed[0].key='minecraft:overworld/1,1,0';
  const next=createNeuralNavigator({worldId:'migration',memory:old});
  assert.equal(next.snapshot().samples,1);assert.equal(next.snapshot().rememberedFailures,0);
  assert.equal(next.export().schemaVersion,2);assert.deepEqual(next.export().weights,old.weights);
});
test('attaching a learning policy preserves prior costs and restores the application policy on detach',()=>{
  const client=new EventEmitter();client.state={dimension:walk.dimension,health:20,food:20};client.entities=new Map();
  const prior={cost:()=>7};client.navigationPolicy=prior;
  const m=createNeuralNavigator({worldId:'composed'}),detach=attachNeuralNavigation(client,m);
  assert.equal(client.navigationPolicy.cost(walk.from,walk.to,walk.kind),7);
  m.record({...walk,outcome:'failure'});assert.ok(client.navigationPolicy.cost(walk.from,walk.to,walk.kind)>7);
  prior.cost=()=>1000;assert.equal(client.navigationPolicy.cost(walk.from,walk.to,walk.kind),1000);
  prior.cost=()=>-1;assert.throws(()=>client.navigationPolicy.cost(walk.from,walk.to,walk.kind),/Prior navigation cost/);
  detach();assert.equal(client.navigationPolicy,prior);assert.equal(client.listenerCount('navigationStep'),0);
});
