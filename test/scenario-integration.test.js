import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import minecraftData from 'minecraft-data';
import { createCore, createResourceReactor, catalogFromMinecraftData, createCatalog, importVanillaRecipes, validateScenario, createCombatReactor } from '../overmindmc.js';
const mc = minecraftData('1.21.1');
const crafting = {
  'minecraft:birch_planks': { type: 'minecraft:crafting_shapeless', ingredients: [{ item: 'minecraft:birch_log' }], result: { id: 'minecraft:birch_planks', count: 4 } },
  'minecraft:oak_planks': { type: 'minecraft:crafting_shapeless', ingredients: [{ item: 'minecraft:oak_log' }], result: { id: 'minecraft:oak_planks', count: 4 } },
  'minecraft:table': { type: 'minecraft:crafting_shaped', pattern: ['PP', 'PP'], key: { P: { tag: 'minecraft:planks' } }, result: { id: 'minecraft:crafting_table' } }
};
test('resource reactor selects nearby birch for a generic table instead of distant oak', () => {
  const catalog = createCatalog({ version: 'test', items: ['oak_log', 'birch_log', 'oak_planks', 'birch_planks', 'crafting_table'].map(n => ({ id: 'minecraft:' + n })), blocks: ['oak_log', 'birch_log'].map(n => ({ id: 'minecraft:' + n })),
    recipes: importVanillaRecipes(crafting, { 'minecraft:planks': { values: ['minecraft:oak_planks', 'minecraft:birch_planks'] } }) });
  const reactor = createResourceReactor({ catalog, targets: { 'minecraft:crafting_table': 1 } });
  const o = { self: { position: { x: 0, y: 64, z: 0 } }, inventory: {}, world: { nearbyBlocks: { 'minecraft:oak_log': true, 'minecraft:birch_log': true }, sampledBlocks: [
    { name: 'minecraft:oak_log', position: { x: 60, y: 64, z: 0 } }, { name: 'minecraft:birch_log', position: { x: 3, y: 64, z: 0 } }
  ] } };
  assert.equal(reactor.react(o).action.args.block, 'minecraft:birch_log');
  o.inventory['minecraft:oak_planks'] = 4;
  assert.equal(reactor.react(o).action.skill, 'craft');
});
test('all authored JSON scenarios validate against the same public parser', async () => {
  const directory = new URL('../examples/scenarios/', import.meta.url);
  const files = await readdir(directory); assert.ok(files.length >= 6);
  for (const file of files.filter(f => f.endsWith('.json'))) validateScenario(JSON.parse(await readFile(new URL(file, directory))));
});
test('event-driven threat wakeup bypasses an idle ten-second tick without duplicate execution', async () => {
  let urgent, removed = false, threat = false, executing = 0, overlap = false, actions = 0;
  let finish; const attacked = new Promise(r => { finish = r; });
  const adapter = {
    describe: () => ({ protocolVersion: 1, skills: ['combat'] }),
    subscribeUrgent: callback => { urgent = callback; return () => { removed = true; }; },
    observe: async () => ({ self: { health: 20, position: { x: 0, y: 64, z: 0 } }, entities: threat ? [{ id: '1', name: 'zombie', kind: 'entity', hostile: true, position: { x: 2, y: 64, z: 0 } }] : [] }),
    execute: async () => { if (++executing > 1) overlap = true; actions++; threat = false; await new Promise(r => setTimeout(r, 20)); executing--; finish(); return { ok: true }; }
  };
  const core = createCore({ config: { schemaVersion: 4, name: 'Wake', worldId: 'test', tickIntervalMs: 10000 }, adapter, reactors: [createCombatReactor()] });
  core.start(); await new Promise(r => setTimeout(r, 20)); threat = true;
  const before = Date.now(); urgent(); urgent();
  await Promise.race([attacked, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('No urgent action')), 1000); t.unref(); })]);
  assert.ok(Date.now() - before < 1000); await core.stop(); assert.equal(actions, 1); assert.equal(overlap, false); assert.equal(removed, true);
});
test('combat policy leaves dragon tactics to the End controller', () => {
  const o = { self: { health: 20, position: { x: 0, y: 64, z: 0 } }, entities: [{ id: '1', name: 'ender_dragon', hostile: true, position: { x: 3, y: 64, z: 0 } }] };
  assert.equal(createCombatReactor().react(o).action, null);
});
test('full registry accepts reusable scenario targets without a game client', () => {
  const catalog = catalogFromMinecraftData(mc);
  assert.ok(catalog.item('ender_eye')); assert.ok(catalog.block('end_portal_frame')); assert.ok(catalog.recipesFor('blaze_powder').length);
});
