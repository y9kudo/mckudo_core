import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { catalogFromMinecraftData } from '../src/catalog.js';
import { createCore } from '../src/core.js';
import { resourceSources } from '../src/taxonomy.js';
import { createLootReactor, createSurvivalReactor, diamondSetTargets, diamondSetCondition } from '../src/survival-brain.js';
import { itemValue, proposeTrade, survivalReserves } from '../src/item-value.js';
import { matches } from '../src/conditions.js';

const registry = minecraftData('1.21.1'), catalog = catalogFromMinecraftData(registry);
const rid = n => n.startsWith('minecraft:') ? n : 'minecraft:' + n;
const key = p => `${p.x},${p.y},${p.z}`;
const p = { x: 0, y: 64, z: 0 };
const observation = (inventory = {}, sampledBlocks = []) => ({ dimension: 'minecraft:overworld', self: { position: p, health: 20, food: 20, freeInventorySlots: 36 }, inventory, world: { sampledBlocks }, drops: [] });
const block = (name, position) => ({ ...registry.blocksByName[name], position });

test('core-owned survival starts by mining the nearest usable tree class and replans crafting from inventory', () => {
  const r = createSurvivalReactor({ catalog, target: 'wood', exploration: false });
  const o = observation({}, [{ name: rid('birch_log'), position: { x: 4, y: 64, z: 0 } }, { name: rid('oak_log'), position: { x: 20, y: 64, z: 0 } }]);
  assert.equal(r.react(o).action.args.block, rid('birch_log'));
  o.inventory[rid('birch_log')] = 1;
  const next = r.react(o); assert.equal(next.action.skill, 'craft'); assert.equal(next.action.args.item, rid('birch_planks'));
  o.inventory = { [rid('birch_planks')]: 4 }; assert.equal(r.react(o).action.args.item, rid('crafting_table'));
  assert.notEqual(r.snapshot().status, 'completed');
  o.inventory = { [rid('crafting_table')]: 1 }; assert.equal(r.react(o).action, null); assert.equal(r.snapshot().status, 'completed');
  o.inventory = {}; r.react(o); assert.notEqual(r.snapshot().status, 'completed');
});

test('deepslate diamonds require an iron-tier pickaxe; missing source is explicitly blocked', () => {
  const r = createSurvivalReactor({ catalog, exploration: false });
  const o = observation({ 'minecraft:crafting_table': 1, 'minecraft:wooden_pickaxe': 1, 'minecraft:stone_pickaxe': 1, 'minecraft:furnace': 1 }, [{ name: rid('deepslate_diamond_ore'), position: { x: 4, y: -54, z: 0 } }]);
  const result = r.react(o); assert.notEqual(result.action?.args.block, rid('deepslate_diamond_ore')); assert.equal(r.snapshot().stage, 'iron_pickaxe');
  const unknown = createSurvivalReactor({ catalog, target: 'wood', exploration: false });
  assert.equal(unknown.react(observation()).action, null); assert.equal(unknown.snapshot().status, 'blocked');
});

test('failed mining changes candidate and never retries the same coordinate during backoff', () => {
  const r = createSurvivalReactor({ catalog, target: 'wood', exploration: false, clock: () => 1000 });
  const o = observation({}, [1, 2].map(x => ({ name: rid('oak_log'), position: { x, y: 64, z: 0 } })));
  const first = r.react(o); r.recordResult({ outcome: 'failure', detail: 'No reachable face' }, first.action);
  const second = r.react(o); assert.equal(second.action.args.x, 2); assert.equal(r.snapshot().lastFailure.attempts, 1);
});

test('loot outranks crafting, tracks current drop origin, and backs off failed drops', () => {
  const r = createLootReactor({ clock: () => 1000 }), o = observation();
  o.drops = [{ id: '1', name: 'diamond', count: 1, position: { x: 2, y: 65, z: 0 } }];
  const first = r.react(o); assert.equal(first.action.skill, 'collect'); assert.ok(first.priority > 5);
  o.drops[0].position.x = 3; assert.equal(r.react(o).action.args.origin.x, 3);
  r.recordResult({ outcome: 'failure' }); assert.equal(r.react(o).action, null);
});

test('safe staircase mines adjacent cells and rejects unknown support or liquids', () => {
  const world = { blockAt: q => block(q.y <= 63 ? 'stone' : 'air', q) };
  const client = { world, options: { username: 'Miner' } }, r = createSurvivalReactor({ client, catalog });
  const o = observation(Object.fromEntries(['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'iron_pickaxe'].map(n => [rid(n), 1])));
  o.world.sampledBlocks=[{name:rid('crafting_table'),position:{x:3,y:64,z:0}},{name:rid('furnace'),position:{x:4,y:64,z:0}}];
  const step = r.react(o); assert.equal(step.action.skill, 'dig'); assert.equal(step.action.args.y, 63); assert.notEqual(`${step.action.args.x},${step.action.args.z}`, '0,0');
  const unknown = createSurvivalReactor({ catalog, client: { ...client, world: { blockAt: () => null } } });
  assert.equal(unknown.react(o).action, null);
  const flooded = createSurvivalReactor({ catalog, client: { ...client, world: { blockAt: q => block(q.y < 64 ? 'lava' : 'air', q) } } });
  assert.equal(flooded.react(o).action, null);
});

test('bounded library loop reaches a full diamond set from zero in a deterministic executor, including drops and furnace', async () => {
  const voxels = new Map(), inventory = {}, drops = [], actions = [], stations = [];
  let index = 0;
  for (const [name, quantity] of [['spruce_log', 40], ['stone', 40], ['deepslate_iron_ore', 8], ['deepslate_diamond_ore', 40]]) for (let i = 0; i < quantity; i++) {
    const q = { x: 3 + index++ * 2, y: 64, z: 0 }; voxels.set(key(q), block(name, q));
  }
  const world = { blockAt: q => voxels.get(key(q)) || block(q.y < 64 ? 'stone' : 'air', q) };
  const client = { world, options: { username: 'SurvivalTest' } };
  const survival = createSurvivalReactor({ catalog, client, exploration: false }), loot = createLootReactor({ radius: 64 });
  const observe = () => ({ ...observation({ ...inventory }, [...voxels.values()].filter(b => b.name !== 'air').map(b => ({ name: rid(b.name), position: b.position })).concat(stations)), drops: structuredClone(drops) });
  const gain = (item, n) => { item = rid(item); inventory[item] = (inventory[item] || 0) + n; assert.ok(inventory[item] >= 0); };
  const adapter = { describe: () => ({ protocolVersion: 1, skills: ['dig', 'collect', 'craft', 'ensureStation', 'smelt'] }), observe: async () => observe(),
    async execute(action) {
      actions.push(action); const a = action.args;
      if (action.skill === 'dig') {
        const actual = world.blockAt(a); assert.equal(rid(actual.name), a.block);
        const source = resourceSources(catalog, { availableBlocks: [a.block] })[0]; assert.ok(source);
        assert.ok(!source.tools.length || source.tools.some(t => inventory[t] > 0), `No tool for ${a.block}`);
        voxels.set(key(a), block('air', a));
        // Server simulation puts drops near the bot after an approach, without directly awarding inventory.
        drops.push({ id: String(actions.length), name: source.item.slice(10), count: 1, position: { ...p, x: 1 } });
      } else if (action.skill === 'collect') {
        const i = drops.findIndex(d => rid(d.name) === a.item); assert.ok(i >= 0); gain(a.item, drops[i].count); drops.splice(i, 1);
      } else if (action.skill === 'craft') {
        const recipes = catalog.recipesFor(a.item).filter(r => r.executable && r.type.startsWith('minecraft:crafting_'));
        const recipe = recipes.find(r => (!r.station || stations.some(s => s.name === r.station)) && r.ingredients.every(g => g.choices.some(choice => (inventory[choice] || 0) >= g.count * Math.ceil(a.count / r.output.count))));
        assert.ok(recipe, `No executable recipe for ${a.item}`); const batches = Math.ceil(a.count / recipe.output.count);
        for (const g of recipe.ingredients) gain(g.choices.find(choice => inventory[choice] >= g.count * batches), -g.count * batches);
        gain(a.item, recipe.output.count * batches);
      } else if (action.skill === 'ensureStation') {
        assert.ok(inventory[rid(a.station)]); gain(a.station, -1); stations.push({ name: rid(a.station), position: { x: 0, y: 64, z: 2 + stations.length } });
      } else if (action.skill === 'smelt') {
        assert.ok(stations.some(s => s.name === rid('furnace'))); assert.ok(inventory[a.input] >= a.count); assert.ok(inventory[a.fuel] > 0);
        gain(a.input, -a.count); gain(a.fuel, -1); gain(a.item, a.count);
      } else assert.fail('Unexpected skill');
      return { ok: true };
    }
  };
  const core = createCore({ config: { schemaVersion: 4, name: 'LibraryLoop', worldId: 'deterministic-executor' }, adapter, reactors: [loot, survival] });
  survival.attach(core); loot.attach(core);
  for (let tick = 0; tick < 320 && !matches(diamondSetCondition(), observe()); tick++) {
    await core.tick(); assert.notEqual(core.snapshot().status, 'fault', core.snapshot().reason);
    assert.notEqual(survival.snapshot().status, 'blocked', survival.snapshot().reason);
  }
  assert.ok(matches(diamondSetCondition(), observe()), JSON.stringify(survival.snapshot()));
  assert.deepEqual(Object.keys(diamondSetTargets()).filter(n => !inventory[n]), []);
  assert.ok(actions.some(a => a.skill === 'smelt')); assert.ok(actions.some(a => a.skill === 'collect')); assert.ok(actions.some(a => a.args.item === rid('wooden_pickaxe')));
  const firstIron = actions.findIndex(a => a.skill === 'dig' && a.args.block === rid('deepslate_iron_ore'));
  assert.ok(actions.findIndex(a => a.args.item === rid('stone_pickaxe')) < firstIron);
  await core.stop();
});

test('item utility protects reserves and offers only mutually beneficial trades or surplus gifts', () => {
  const from = { [rid('diamond')]: 4, [rid('iron_pickaxe')]: 1 }, to = { [rid('iron_ingot')]: 24 };
  assert.equal(survivalReserves(from)[rid('iron_pickaxe')], 1);
  assert.ok(itemValue('diamond', { targets: { [rid('diamond')]: 1 } }) > itemValue('diamond'));
  const trade = proposeTrade({ from, to, fromTargets: { [rid('iron_ingot')]: 3 }, toTargets: { [rid('diamond')]: 3 } });
  assert.equal(trade.kind, 'trade'); assert.ok(trade.fromGain > 0 && trade.toGain > 0); assert.ok(trade.give.every(s => s.item !== rid('iron_pickaxe')));
  assert.equal(proposeTrade({ from: { [rid('iron_pickaxe')]: 1 }, to: {}, toTargets: { [rid('iron_pickaxe')]: 1 } }), null);
  assert.equal(proposeTrade({ from: { [rid('diamond')]: 2 }, to: {}, toTargets: { [rid('diamond')]: 1 } }).kind, 'gift');
});
