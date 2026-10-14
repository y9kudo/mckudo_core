import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeedsReactor} from '../src/needs.js';

test('injured agents eat at 17 hunger to enable regeneration while healthy agents keep that reserve',()=>{
  const r=createNeedsReactor(),o={self:{health:4,food:17},inventory:{'minecraft:bread':1}};
  assert.equal(r.react(o).action.skill,'eat');
  assert.equal(r.react({...o,self:{health:20,food:17}}).action,null);
});
test('critical health permits a golden apple at full hunger and emergency flesh only without safer food',()=>{
  const r=createNeedsReactor();
  assert.equal(r.react({self:{health:3,food:20},inventory:{'minecraft:golden_apple':1}}).action.args.item,'golden_apple');
  assert.equal(r.react({self:{health:3,food:17},inventory:{'minecraft:rotten_flesh':1}}).action.args.item,'rotten_flesh');
  assert.equal(r.react({self:{health:3,food:17},inventory:{'minecraft:bread':1,'minecraft:rotten_flesh':1}}).action.args.item,'bread');
});

test('food recovery harvests mature crops, preserves immature crops and crafts bread from wheat',()=>{
  const reactor=createNeedsReactor(),o={dimension:'minecraft:overworld',self:{health:8,food:14,position:{x:0,y:64,z:0}},inventory:{},world:{sampledBlocks:[{name:'minecraft:carrots',position:{x:3,y:64,z:0},properties:{age:6}}]}};
  assert.equal(reactor.react(o).action,null);
  o.world.sampledBlocks[0].properties.age=7;assert.equal(reactor.react(o).action.skill,'dig');
  o.inventory={'minecraft:wheat':3};assert.equal(reactor.react(o).action.args.item,'minecraft:bread');
  o.inventory={'minecraft:carrot':2};assert.equal(reactor.react(o).action.skill,'eat');
});

test('low-health food hunting targets an observed adult animal and rejects players, babies and blocked views',()=>{
  const r=createNeedsReactor(),o={self:{health:8,food:14,position:{x:0,y:64,z:0}},inventory:{},entities:[{id:'1',name:'cow',position:{x:15,y:64,z:0}}]};
  assert.equal(r.react(o).action.args.retreatHealth,0);
  for(const change of [{kind:'player'},{isBaby:true},{named:true},{visible:false}])assert.equal(r.react({...o,entities:[{...o.entities[0],...change}]}).action,null);
});
