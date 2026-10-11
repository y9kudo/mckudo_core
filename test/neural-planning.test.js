import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {createNeuralPlanner} from '../src/neural-planning.js';
import {createSurvivalReactor} from '../src/survival-brain.js';
import {catalogFromMinecraftData} from '../src/catalog.js';
import {planExploration} from '../src/exploration.js';
const before={dimension:'minecraft:overworld',self:{health:20,food:20,freeInventorySlots:36,position:{x:0,y:64,z:0}},inventory:{},world:{sampledBlocks:[{name:'minecraft:oak_log',position:{x:2,y:64,z:0}},{name:'minecraft:birch_log',position:{x:3,y:64,z:0}}]}};
const oak={skill:'dig',args:{x:2,y:64,z:0,block:'minecraft:oak_log'}},birch={skill:'dig',args:{x:3,y:64,z:0,block:'minecraft:birch_log'}};
test('actual backprop changes resource choice, while recipe dependencies remain valid',()=>{
  const model=createNeuralPlanner({worldId:'new-world'}),catalog=catalogFromMinecraftData(minecraftData('1.21.1'));
  const r=createSurvivalReactor({catalog,client:{planningPolicy:model},targets:{'#logs':1},exploration:false});
  assert.equal(r.react(before).action.args.block,'minecraft:oak_log');
  for(let i=0;i<200;i++){model.record({before,action:oak,outcome:'failure'});model.record({before,action:birch,after:before,outcome:'success'});}
  assert.ok(model.assess(before,oak).failureProbability>model.assess(before,birch).failureProbability+.4);
  assert.equal(r.react(before).action.args.block,'minecraft:birch_log');
  const craft=createSurvivalReactor({catalog,client:{planningPolicy:model},targets:{'minecraft:wooden_pickaxe':1},exploration:false});
  craft.react({...before,inventory:{'minecraft:birch_log':3}});
  const trace=craft.snapshot().plan;assert.equal(trace[0].item,'minecraft:wooden_pickaxe');assert.ok(trace[0].ingredients.length);assert.ok(trace.some(t=>t.item==='minecraft:birch_planks'));
  const restored=createNeuralPlanner({worldId:'new-world',memory:model.export()});assert.equal(restored.assess(before,oak).failureProbability,model.assess(before,oak).failureProbability);
  assert.throws(()=>createNeuralPlanner({worldId:'other-world',memory:model.export()}),/другого мира/);
});
test('cancelled actions and unconfirmed combat dispatches do not train the planner',()=>{
  const model=createNeuralPlanner({worldId:'w'});
  assert.equal(model.record({before,action:oak,outcome:'cancelled'}),false);
  assert.equal(model.record({before,action:{skill:'combat',args:{}},outcome:'success'}),false);
  assert.equal(model.snapshot().samples,0);
  assert.throws(()=>model.assess(before,{skill:'craft',args:{count:NaN}}),/признаки/);
  const m=model.export();m.weights.v[0]=Infinity;assert.throws(()=>createNeuralPlanner({worldId:'w',memory:m}));
});
test('exploration avoids familiar areas and learned risks but never invents unknown support',()=>{
  const ground=p=>p.y<64?{name:'stone',boundingBox:'block'}:{name:'air'};
  const options={position:{x:0,y:64,z:0},getBlock:ground,radius:8,candidateCost:p=>p.x>0?30:0};
  const result=planExploration(options);assert.equal(result.status,'planned');assert.ok(result.target.x<=0);
  assert.equal(planExploration({...options,getBlock:()=>null}).status,'blocked');
  assert.throws(()=>planExploration({...options,candidateCost:()=>-1}),/candidateCost/);
});
