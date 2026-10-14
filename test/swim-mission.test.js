import test from 'node:test';
import assert from 'node:assert/strict';
import {defineMission,createScenario,createCatalog} from '../overmindmc.js';
test('a beginner swim command compiles and completes only at the destination cell',()=>{
  const scenario=defineMission([{swim:{x:4,y:62,z:7}}]);assert.equal(scenario.steps[0].type,'swim');
  const catalog=createCatalog({version:'1.21.1',items:[],blocks:[]}),controller=createScenario({scenario,catalog});
  const observation={self:{health:20,position:{x:0,y:62,z:0}},dimension:'minecraft:overworld',inventory:{},world:{sampledBlocks:[]}};
  assert.equal(controller.reactor.react(observation).action.skill,'swim');assert.equal(controller.snapshot().status,'running');
  controller.reactor.react({...observation,self:{...observation.self,position:{x:4.5,y:62.05,z:7.5}}});assert.equal(controller.snapshot().status,'completed');
  assert.throws(()=>defineMission([{swim:{x:1,y:NaN,z:2}}]),/swim.y/);
  assert.throws(()=>defineMission([{swim:{x:1,y:2,z:3},go:{x:1,y:2,z:3}}]),/exactly one command/i);
});
