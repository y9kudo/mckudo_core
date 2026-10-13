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
