import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuntingReactor,createCombatReactor} from '../mckudo_core.js';
const base=()=>({dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20,food:20,freeInventorySlots:36},inventory:{},entities:[{id:'7',name:'cow',kind:'entity',position:{x:2,y:64,z:0}}],world:{sampledBlocks:[]}});
test('a fed empty-handed agent gathers tools before stockpiling meat, but hunts if hungry',()=>{
  const r=createHuntingReactor({targets:{},prepareWool:false}),o=base();assert.equal(r.react(o).action,null);
  o.self.food=10;assert.equal(r.react(o).action.skill,'combat');o.self.food=20;o.inventory['minecraft:wooden_axe']=1;assert.equal(r.react(o).action.skill,'combat');
  assert.equal(createHuntingReactor({targets:{},prepareWool:false,reserveRequiresTools:false}).react(base()).action.skill,'combat');
});
test('critical-health defense uses a navigation retreat when the adapter supports it',()=>{
  const r=createCombatReactor({attackPlayers:false,pathRetreat:true}),o=base();o.self.health=5;o.entities=[{id:'8',name:'zombie',kind:'entity',hostile:true,position:{x:2,y:64,z:0},health:20}];
  const escape=r.react(o);assert.equal(escape.action.skill,'evade');assert.deepEqual(escape.action.args.from,o.entities[0].position);
  o.self.health=20;assert.equal(r.react(o).action.skill,'combat');
});
test('retreat does not authorize attacking an unrelated player',()=>{
  const r=createCombatReactor({attackPlayers:false,pathRetreat:true}),o=base();o.self.health=4;o.entities=[{id:'9',name:'player',kind:'player',position:{x:2,y:64,z:0}}];
  assert.equal(r.react(o).action,null);
});
