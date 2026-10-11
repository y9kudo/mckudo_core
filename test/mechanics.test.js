import test from 'node:test';
import assert from 'node:assert/strict';
import md from 'minecraft-data';
import {planBrewing,planNetheriteUpgrade,dimensionTravelPolicy} from '../src/mechanics.js';
const registry=md('1.21.1');
test('brewing plans ingredients, extended effects, bottle forms and version availability',()=>{
  const plan=planBrewing({registry,potion:'long_fire_resistance',form:'splash_potion'});assert.equal(plan.status,'planned');assert.deepEqual(plan.steps.map(s=>s.ingredient),['minecraft:nether_wart','minecraft:magma_cream','minecraft:redstone','minecraft:gunpowder']);assert.equal(plan.bottles,3);assert.equal(plan.fuel.count,1);
  assert.equal(planBrewing({registry:md('1.20.4'),potion:'infested'}).status,'blocked');assert.equal(planBrewing({registry,potion:'not_real',from:'not_real'}).status,'blocked');
});
test('netherite planner respects template version and resource deficits',()=>{
  const p=planNetheriteUpgrade({registry,item:'diamond_chestplate',inventory:{'minecraft:diamond_chestplate':1,'minecraft:netherite_ingot':1}});assert.deepEqual(p.missing,{'minecraft:netherite_upgrade_smithing_template':1});assert.equal(p.preserveComponents,true);
  assert.equal(planNetheriteUpgrade({registry:md('1.19.4'),item:'diamond_pickaxe',inventory:{'minecraft:diamond_pickaxe':1,'minecraft:netherite_ingot':1}}).status,'ready');assert.equal(planNetheriteUpgrade({registry:md('1.15.2'),item:'diamond_pickaxe'}).status,'unsupported');
});
test('travel policy does not use water or beds in Nether and limits End drops',()=>{
  assert.equal(dimensionTravelPolicy('minecraft:the_nether').waterUsable,false);assert.equal(dimensionTravelPolicy('minecraft:the_end').bedsUsable,false);assert.equal(dimensionTravelPolicy('minecraft:the_end').maxDrop,3);assert.throws(()=>dimensionTravelPolicy('unknown'));
});
