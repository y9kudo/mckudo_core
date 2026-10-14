import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCore, catalogFromMinecraftData, createBlockTaxonomy, resourceSources, planResources, planResourceClasses, planRoute, createDefenseReactor, createFoodReactor, createCatalog, importVanillaRecipes } from '../overmindmc.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
import { createWorldActions } from '../adapters/mineflayer-actions.js';
import { createNavigator } from '../adapters/mineflayer-navigation.js';
import { planExploration, createResourceReactor } from '../overmindmc.js';
import { parseJavaDataArchive } from '../src/java-data.js';
const require = createRequire(import.meta.url);
const data = require('minecraft-data')('1.21.1'), catalog = catalogFromMinecraftData(data), taxonomy = createBlockTaxonomy(catalog);
const signal = () => new AbortController().signal;
const station = { 'minecraft:crafting_table': { x: 0, y: 0, z: 3 } };
const air = { name: 'air', boundingBox: 'empty' }, stone = { name: 'stone', boundingBox: 'block', diggable: true, hardness: 1.5 };

test('every 1.21.1 block is classified; overlapping semantic classes and mod classes inherit', () => {
  assert.equal(catalog.summary().blocks, 1060); assert.equal(taxonomy.members('all').length, 1060);
  for (const id of ['oak_leaves', 'acacia_leaves']) { assert.ok(taxonomy.has(id, 'tree')); assert.ok(taxonomy.has(id, 'leaves')); assert.equal(taxonomy.has(id, 'logs'), false); }
  assert.ok(taxonomy.has('deepslate_iron_ore', 'ores')); assert.ok(taxonomy.has('deepslate_iron_ore', 'deepslate_ores'));
  const custom = createBlockTaxonomy(catalog, { classes: { metal_source: { members: ['deepslate_iron_ore'], parents: ['custom_resource'] } } });
  assert.ok(custom.has('deepslate_iron_ore', 'custom_resource'));
  assert.throws(() => createBlockTaxonomy(catalog, { classes: { a: { parents: ['b'] }, b: { parents: ['a'] } } }), /cycle/i);
  assert.ok(taxonomy.select({ all: ['tree'], none: ['leaves', 'saplings'] }).includes('minecraft:acacia_log'));
});
test('savanna recipes use acacia end to end; class targets resolve an available wood', () => {
  const sources = resourceSources(catalog, { availableBlocks: ['acacia_log'] });
  const plan = planResources({ catalog, targets: { wooden_pickaxe: 1 }, sources, stations: station, maxNodes: 10000 });
  assert.equal(plan.status, 'planned', plan.reason);
  assert.ok(plan.actions.some(s => s.action.args.block === 'minecraft:acacia_log'));
  assert.equal(plan.actions.some(s => s.action.args.block === 'minecraft:oak_log'), false);
  const generic = planResourceClasses({ catalog, targets: { '#planks': 8 }, sources });
  assert.equal(generic.status, 'planned', generic.reason); assert.deepEqual(generic.resolvedTargets, { 'minecraft:acacia_planks': 8 });
});
test('normal/deepslate ores share output and retain harvesting tool requirements', () => {
  const sources = resourceSources(catalog, { availableBlocks: ['iron_ore', 'deepslate_iron_ore', 'acacia_leaves'] });
  assert.equal(sources.length, 2); assert.ok(sources.every(s => s.item === 'minecraft:raw_iron' && s.tools.includes('minecraft:stone_pickaxe')));
  const plan = planResources({ catalog, targets: { raw_iron: 2 }, inventory: { 'minecraft:stone_pickaxe': 1 }, sources: sources.slice(1) });
  assert.equal(plan.status, 'planned'); assert.equal(plan.actions[0].action.args.block, 'minecraft:deepslate_iron_ore');
});
test('A* walks around walls, bounds search, and never assumes unloaded cells are air', () => {
  const getBlock = p => Math.abs(p.x) > 5 || Math.abs(p.z) > 5 ? null : p.y === -1 ? stone : p.x === 1 && p.z === 0 && p.y >= 0 && p.y <= 3 ? stone : p.y >= 0 ? air : null;
  const args = { start: { x: 0, y: 0, z: 0 }, goal: { x: 3, y: 0, z: 0 }, getBlock };
  const result = planRoute(args); assert.equal(result.status, 'planned'); assert.ok(result.steps.some(s => s.position.z !== 0));
  assert.equal(planRoute({ ...args, maxNodes: 1 }).status, 'blocked');
  assert.equal(planRoute({ ...args, goal: { x: 10, y: 0, z: 0 } }).status, 'blocked');
  const ac = new AbortController(); ac.abort(); assert.throws(() => planRoute({ ...args, signal: ac.signal }));
});
test('A* plans bridge placements before movement and respects material budget and unknown floor', () => {
  const getBlock = p => p.z !== 0 || p.x < 0 || p.x > 3 ? null : p.y === -1 ? p.x === 1 || p.x === 2 ? air : stone : p.y >= 0 && p.y <= 2 ? air : null;
  const args = { start: { x: 0, y: 0, z: 0 }, goal: { x: 3, y: 0, z: 0 }, getBlock };
  assert.equal(planRoute(args).status, 'blocked'); assert.equal(planRoute({ ...args, bridgeBudget: 1 }).status, 'blocked');
  const plan = planRoute({ ...args, bridgeBudget: 2 }); assert.equal(plan.status, 'planned'); assert.equal(plan.bridgeUsed, 2);
  assert.deepEqual(plan.steps.map(s => s.kind), ['bridge', 'walk', 'bridge', 'walk', 'walk']);
  assert.equal(planRoute({ ...args, getBlock: p => p.x === 1 && p.y === -1 ? null : getBlock(p), bridgeBudget: 2 }).status, 'blocked');
});
test('A* requires explicit dig policy, avoids adjacent fluids and honors step headroom', () => {
  const getBlock = p => p.y === -1 ? stone : p.x === 1 && p.z === 0 && p.y <= 1 ? stone : p.y >= 0 && p.y <= 3 ? air : null;
  const result = planRoute({ start: { x: 0, y: 0, z: 0 }, goal: { x: 2, y: 0, z: 0 }, getBlock, maxDistance: 2, canDig: () => true });
  assert.equal(result.status, 'planned');
  const lava = planRoute({ start: { x: 0, y: 0, z: 0 }, goal: { x: 1, y: 0, z: 0 }, getBlock: p => p.x === 1 && p.y === -1 ? { name: 'lava', boundingBox: 'empty' } : getBlock(p), canDig: () => true });
  assert.equal(lava.status, 'blocked');
});
test('threat preempts mining, waits for cancellation settlement and preserves workflow retry budget', async () => {
  let threat = false, mining = false, attacks = 0, observed = 0, started;
  const began = new Promise(r => { started = r; });
  const observe = async () => ({ self: { health: 20, position: { x: 0, y: 0, z: 0 } }, entities: threat ? [{ id: 'z', name: 'zombie', hostile: true, position: { x: 2, y: 0, z: 0 } }] : [] });
  const adapter = { describe: () => ({ protocolVersion: 1, skills: ['gather', 'attack'] }), observe,
    observeThreats: async () => { observed++; return observe(); },
    execute: async (action, { signal }) => {
      if (action.skill === 'attack') { assert.equal(mining, false); attacks++; return; }
      mining = true; started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      await delay(20); mining = false; signal.throwIfAborted();
    } };
  const core = createCore({ config: { schemaVersion: 4, name: 'preemption', worldId: 'test', workflows: [{ id: 'wood', steps: [{ id: 'mine', action: { skill: 'gather' }, maxAttempts: 1 }] }] }, adapter, reactors: [createDefenseReactor()], preemptionMs: 50 });
  const pending = core.tick(); await began; threat = true; await pending;
  assert.equal(core.snapshot().lastResult.outcome, 'cancelled'); assert.equal(core.snapshot().paused, false); assert.equal(core.snapshot().workflows[0].steps.mine.attempts, 0);
  await core.tick(); assert.equal(attacks, 1); assert.ok(observed >= 1); await core.stop();
});
test('food policy chooses safe food, mature crops and permitted animals, excludes players and raw chicken', () => {
  const reactor = createFoodReactor({ allowHunting: true });
  const o = { self: { food: 5, position: { x: 0, y: 0, z: 0 } }, inventory: { 'minecraft:chicken': 1, 'minecraft:bread': 1 }, world: {}, entities: [] };
  assert.equal(reactor.react(o).action.args.item, 'minecraft:bread'); delete o.inventory['minecraft:bread']; assert.equal(reactor.react(o).action, null);
  o.world.crops = [{ name: 'minecraft:wheat', mature: false, position: { x: 1, y: 0, z: 0 } }]; assert.equal(reactor.react(o).action, null);
  o.world.crops[0].mature = true; assert.equal(reactor.react(o).action.skill, 'harvest');
  o.world.crops = []; o.entities = [{ id: 'p', name: 'cow', kind: 'player', position: { x: 1, y: 0, z: 0 } }]; assert.equal(reactor.react(o).action, null);
  o.entities[0].kind = 'entity'; assert.equal(reactor.react(o).action.skill, 'hunt');
  assert.equal(createFoodReactor().react(o).action, null);
});
test('food cooks available raw meat in a smoker using a catalog recipe', () => {
  const raw = { cook: { type: 'minecraft:smoking', ingredient: { item: 'minecraft:beef' }, result: { id: 'minecraft:cooked_beef' } } };
  const c = createCatalog({ version: 'test', items: ['beef', 'cooked_beef', 'oak_planks'].map(n => ({ id: n })), blocks: [], recipes: importVanillaRecipes(raw) });
  const r = createFoodReactor({ catalog: c }).react({ self: { food: 5 }, inventory: { 'minecraft:beef': 1, 'minecraft:oak_planks': 1 }, world: { nearbyBlocks: { 'minecraft:smoker': true } } });
  assert.equal(r.action.skill, 'smelt'); assert.equal(r.action.args.station, 'minecraft:smoker');
});
test('adapter increases perception, requests chunks, caches scans and invalidates on block events', async () => {
  const bot = new EventEmitter(); let scans = 0, settings;
  Object.assign(bot, { health: 20, food: 20, version: '1.21.1', entity: { position: { x: 0, y: 64, z: 0 } }, entities: {}, game: { dimension: 'overworld' }, inventory: { items: () => [] }, registry: data,
    pathfinder: {}, setSettings: s => { settings = s; }, findBlocks: args => { scans++; assert.equal(args.maxDistance, 128); return []; } });
  const adapter = createMineflayerAdapter(bot, { goals: { GoalNear: class {}, GoalLookAtBlock: class {} }, trackedBlocks: ['minecraft:acacia_log'] });
  const one = await adapter.observe({ signal: signal() }); await adapter.observe({ signal: signal() });
  assert.equal(settings.viewDistance, 16); assert.equal(scans, 1); assert.equal(one.world.searchRadius, 128);
  await adapter.observeThreats({ signal: signal() }); assert.equal(scans, 1);
  bot.emit('blockUpdate'); await adapter.observe({ signal: signal() }); assert.equal(scans, 2);
  adapter.dispose(); assert.equal(bot.listenerCount('blockUpdate'), 0); assert.equal(bot.listenerCount('entityHurt'), 0);
  assert.throws(() => createMineflayerAdapter(bot, { goals: { GoalNear: class {}, GoalLookAtBlock: class {} }, searchRadius: 9999 }));
});
test('smelting adapter selects smoker, confirms output and closes its window', async () => {
  let result = 0, closed = false, put = false;
  const block = { name: 'smoker', position: {} }, furnace = { inputItem: () => null, outputItem: () => put && !result ? { name: 'cooked_beef' } : null, fuelItem: () => null,
    putFuel: async () => {}, putInput: async () => { put = true; }, takeOutput: async () => { result++; }, close: () => { closed = true; } };
  const bot = { entity: { position: {} }, inventory: { items: () => [{ name: 'beef', count: 1, type: 1 }, { name: 'oak_planks', count: 1, type: 2 }, { name: 'cooked_beef', count: result }] },
    openFurnace: async () => furnace, findBlock: args => { assert.equal(args.maxDistance, 128); assert.ok(args.matching(block)); return block; }, blockAt: () => block, pathfinder: { goto: async () => {} } };
  const actions = createWorldActions(bot, { goals: { GoalLookAtBlock: class {} }, check: s => s.throwIfAborted() });
  await actions.execute('smelt', { input: 'beef', item: 'cooked_beef', fuel: 'oak_planks', count: 1, fuelCount: 1, station: 'smoker' }, signal());
  assert.equal(result, 1); assert.equal(closed, true);
});

test('own movement executor places each bridge block before walking and clears controls on abort', async () => {
  const { Vec3 } = require('vec3'), placed = new Set(), controls = {}, visited = [];
  let target, count = 2;
  const bot = { entity: { position: new Vec3(0.5, 0, 0.5) }, registry: { blocksByName: { cobblestone: { boundingBox: 'block' } } },
    inventory: { items: () => [{ name: 'cobblestone', count }] }, pathfinder: { setGoal() {} },
    blockAt(p) { p = p.floored(); if (p.z !== 0 || p.x < 0 || p.x > 3) return null; return p.y === -1 && (p.x === 0 || p.x === 3 || placed.has(p.x)) ? { ...stone, name: placed.has(p.x) ? 'cobblestone' : 'stone', position: p } : p.y >= -1 && p.y <= 2 ? { ...air, position: p } : null; },
    equip: async () => {}, placeBlock: async (ref, face) => { const p = ref.position.plus(face); placed.add(p.x); count--; },
    lookAt: async p => { target = p.offset(0, -1.5, 0); }, clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
    setControlState(k, value) { controls[k] = value; if (k === 'forward' && value) { assert.equal(bot.blockAt(target.offset(0, -1, 0)).boundingBox, 'block'); bot.entity.position = target; visited.push(target.x); } }
  };
  await createNavigator(bot, { searchRadius: 128, check: s => s.throwIfAborted() })({ x: 3, y: 0, z: 0, bridgeBudget: 2 }, signal());
  assert.equal(count, 0); assert.equal(placed.size, 2); assert.deepEqual(visited, [1.5, 2.5, 3.5]); assert.ok(Object.values(controls).every(v => !v));
  bot.entity.position = new Vec3(0.5, 0, 0.5); bot.setControlState = (k, v) => { controls[k] = v; };
  const ac = new AbortController(); setTimeout(() => ac.abort(), 30);
  await assert.rejects(createNavigator(bot, { searchRadius: 128, check: s => s.throwIfAborted() })({ x: 1, y: 0, z: 0 }, ac.signal));
  assert.ok(Object.values(controls).every(v => !v));
});
test('resource reactor replans with savanna sources and reports completion from observed inventory', () => {
  const r = createResourceReactor({ catalog, targets: { wooden_pickaxe: 1 }, stations: station });
  const o = { self: { position: { x: 0, y: 0, z: 0 } }, inventory: {}, world: { nearbyBlocks: { 'minecraft:acacia_log': true } } };
  assert.equal(r.react(o).action.args.block, 'minecraft:acacia_log');
  o.inventory['minecraft:wooden_pickaxe'] = 1; assert.equal(r.react(o).action, null);
});
test('exploration selects reachable observed ground; visited targets and unknown terrain are excluded', () => {
  const getBlock = p => Math.abs(p.x) <= 10 && Math.abs(p.z) <= 10 ? p.y === -1 ? stone : p.y >= 0 && p.y <= 2 ? air : null : null;
  const args = { position: { x: 0, y: 0, z: 0 }, getBlock, radius: 8, mode: 'ores' };
  const plan = planExploration(args); assert.equal(plan.status, 'planned');
  const next = planExploration({ ...args, visited: [plan.target] }); assert.notDeepEqual(next.target, plan.target);
  assert.equal(planExploration({ ...args, getBlock: () => null }).status, 'blocked');
});
test('archive reader handles a data ZIP without extraction and rejects damaged offsets', () => {
  const name = Buffer.from('data/minecraft/recipe/test.json'), raw = Buffer.from('{"type":"minecraft:crafting_shapeless"}');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + raw.length, 16);
  const zip = Buffer.concat([local, name, raw, central, name, end]);
  assert.equal(parseJavaDataArchive(zip).recipes['minecraft:test'].type, 'minecraft:crafting_shapeless');
  const bad = Buffer.from(zip); bad.writeUInt32LE(0xffffffff, zip.length - 6); assert.throws(() => parseJavaDataArchive(bad));
});
