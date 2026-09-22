import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCore, createSymbolicPlanner, normalizeObservation, validateOperators, validateConfig } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
const read = async name => JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url), 'utf8'));
const config = await read('brain.json'), operators = await read('operators.json');
const signal = () => new AbortController().signal;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const planning = extra => ({ operators, minIntervalMs: 0, ...extra });
const copy = structuredClone;

test('perception keeps unknown facts unknown, validates values, and preserves legacy fields', () => {
  const o = normalizeObservation({ dimension: 'minecraft:overworld', custom: 2 });
  assert.equal(o.world.dimension, o.dimension); assert.equal(o.self.health, null); assert.equal(o.entities, null);
  assert.equal(o.custom, 2); assert.deepEqual(o.inventory, {});
  for (const value of [{ inventory: { 'minecraft:stone': -1 } }, { self: { health: '20' } }, { time: { timeOfDay: 24000 } }, { entities: false }, { world: { dimension: 1 } }, { dimension: 'a', world: { dimension: 'b' } }]) assert.throws(() => normalizeObservation(value));
});
test('goals require schema 3, valid conditions, bounded actions and explicit planning', () => {
  assert.throws(() => validateConfig({ ...config, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateConfig({ ...config, goals: [{ ...config.goals[0], maxActions: 0 }] }), /maxActions/);
  assert.throws(() => createCore({ config, adapter: createSimulator() }), /planning/);
  assert.deepEqual(validateConfig(validateConfig(config)), validateConfig(config));
});
test('brain discovers a plan, confirms real effects, and reuses remaining actions without planner calls', async () => {
  const core = createCore({ config, adapter: createSimulator({ inventory: { 'minecraft:bread': 0 } }), planning: planning() });
  for (let i = 0; i < 6; i++) await core.tick();
  const state = core.snapshot(); assert.equal(state.brain.goals[0].status, 'achieved');
  assert.equal(state.observation.inventory['minecraft:crafting_table'], 1); assert.equal(state.observation.inventory['minecraft:stick'], 4);
  assert.equal(state.brain.calls, 1); assert.equal(state.history.length, 6);
  await core.tick(); assert.equal(core.snapshot().history.length, 6);
});
test('a high priority reaction executes before planning and trace explains false rules', async () => {
  const core = createCore({ config, adapter: createSimulator(), planning: planning() });
  await core.tick(); assert.equal(core.snapshot().lastResult.skill, 'eat'); assert.equal(core.snapshot().brain.calls, 0);
  await core.tick(); const trace = core.snapshot().trace;
  assert.equal(trace.rules[0].matched, false); assert.equal(trace.rules[0].facts[0].value, 17);
  assert.equal(trace.selected.kind, 'goal'); assert.equal(trace.selected.operatorId, 'gather-oak');
});
test('inventory changed by another actor causes replanning instead of executing a stale craft', async () => {
  const sim = createSimulator({ inventory: { 'minecraft:bread': 0 } }); let changed = false;
  const adapter = { ...sim, observe: async ctx => { const o = await sim.observe(ctx); if (changed) o.inventory['minecraft:oak_log'] = 0; return o; } };
  const core = createCore({ config, adapter, planning: planning() });
  await core.tick(); changed = true; await core.tick();
  assert.equal(core.snapshot().brain.calls, 2); assert.equal(core.snapshot().decision.operatorId, 'gather-oak');
  assert.equal(core.snapshot().lastResult.outcome, 'failure');
});
test('unconfirmed effect is a failure, budgeted retries cannot claim success', async () => {
  const c = copy(config); c.rules = []; c.goals[0].maxActions = 1;
  const sim = createSimulator(), core = createCore({ config: c, adapter: { ...sim, execute: async () => ({ ok: true }) }, planning: planning() });
  await core.tick(); assert.equal(core.snapshot().lastResult.outcome, 'failure');
  assert.equal(core.snapshot().brain.goals[0].status, 'failed'); await core.tick(); assert.equal(core.snapshot().history.length, 1);
  core.retryGoal('prepare-workshop'); assert.equal(core.snapshot().brain.goals[0].actions, 0);
});
test('planner rejects invented operators, bad ordering, unknown facts and unfinished proposals', async () => {
  for (const steps of [['teleport-and-spawn-items'], ['make-table'], ['gather-oak']]) {
    let executed = 0;
    const sim = createSimulator();
    const core = createCore({ config: { ...config, rules: [] }, adapter: { ...sim, execute: async () => { executed++; } },
      planning: planning({ planner: { id: 'test', apiVersion: 1, plan: async () => ({ steps }) } }) });
    const state = await core.tick(); assert.equal(state.status, 'blocked'); assert.equal(executed, 0);
    assert.match(state.reason, /Planner/);
  }
  const c = copy(config); c.rules = []; c.goals[0].desired = { fact: '/imaginary/fact', eq: true };
  const core = createCore({ config: c, adapter: createSimulator(), planning: planning() });
  assert.match((await core.tick()).reason, /неизвестный факт/);
  assert.throws(() => validateOperators([{ ...operators[0], effects: [{ fact: '/constructor/x', set: 1 }] }]), /Защищённый/);
  assert.throws(() => validateOperators([{ ...operators[0], effects: [{ fact: '/x', add: 1 }, { fact: '/x/y', set: 1 }] }]), /пересекаться/);
});
test('symbolic search obeys bounds and cancellation; impossible world never causes arbitrary actions', async () => {
  const core = createCore({ config: { ...config, rules: [] }, adapter: createSimulator({ world: { nearbyBlocks: { 'minecraft:oak_log': false } } }), planning: planning() });
  assert.equal((await core.tick()).status, 'blocked'); assert.equal(core.snapshot().history.length, 0);
  const bounded = createCore({ config, adapter: createSimulator(), planning: planning({ planner: createSymbolicPlanner({ maxNodes: 1 }) }) });
  await bounded.tick(); assert.match((await bounded.tick()).reason, /бюджета поиска/);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(createSymbolicPlanner().plan({}, { signal: ac.signal }));
});
test('calls are rate-limited, persisted and capped after restoring memory', async () => {
  let now = 1000, calls = 0;
  const opts = { config: { ...config, rules: [] }, adapter: createSimulator(), clock: () => now,
    planning: planning({ maxCalls: 1, retryDelayMs: 100, planner: { id: 'custom', apiVersion: 1, plan: async () => { calls++; return { steps: [], reason: 'Нет пути' }; } } }) };
  const core = createCore(opts); await core.tick(); await core.tick(); assert.equal(calls, 1);
  now += 1000; const restored = createCore({ ...opts, memory: core.exportMemory() });
  assert.match((await restored.tick()).reason, /бюджет вызовов/); assert.equal(calls, 1);
});
test('planning is locked and cancelled before execution, invalid planner cannot mutate the real observation', async () => {
  const entered = deferred(); let didExecute = false;
  const sim = createSimulator();
  const core = createCore({ config: { ...config, rules: [] }, adapter: { ...sim, execute: async () => { didExecute = true; } }, planning: planning({ planner: {
    id: 'waiting', apiVersion: 1, async plan(context, { signal }) {
      context.observation.inventory['minecraft:crafting_table'] = 999;
      entered.resolve(); await new Promise(r => signal.addEventListener('abort', r, { once: true })); signal.throwIfAborted();
    }
  } }) });
  const first = core.tick(); assert.equal(core.tick(), first); await entered.promise;
  assert.throws(() => core.registerSkill('x', () => {}), /дождись/);
  await core.pause(); assert.equal(didExecute, false); assert.equal(core.snapshot().observation.inventory['minecraft:crafting_table'], 0);
});
test('saved in-flight action needs manual recovery; changed goals invalidate brain memory', async () => {
  const sim = createSimulator(); let saved;
  const core = createCore({ config: { ...config, rules: [] }, adapter: sim, planning: planning() });
  core.once('action:start', () => { saved = core.exportMemory(); }); await core.tick();
  const restored = createCore({ config: { ...config, rules: [] }, adapter: sim, planning: planning(), memory: saved });
  assert.equal((await restored.tick()).brain.goals[0].status, 'interrupted'); assert.equal(restored.snapshot().history.length, 0);
  restored.retryGoal('prepare-workshop'); await restored.tick(); assert.equal(restored.snapshot().decision.operatorId, 'make-planks');
  const c = copy(config); c.rules = []; c.goals[0].maxActions++;
  assert.throws(() => createCore({ config: c, adapter: sim, planning: planning(), memory: saved }), /несовместима/);
});

function craftBot({ requiresTable = false, confirm = true, tablePresent = true, ingredients = 4 } = {}) {
  let crafted = 0, moved = 0;
  const table = { name: 'crafting_table', position: { x: 2, y: 64, z: 0 } };
  const recipe = { result: { id: 2, count: 4 }, requiresTable, delta: [{ id: 1, count: -2 }, { id: 2, count: 4 }] };
  const bot = { health: 20, food: 20, entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' },
    registry: { itemsByName: { stick: { id: 2 }, oak_planks: { id: 1 } } },
    inventory: { items: () => [{ name: 'stick', count: crafted * 4 }] },
    pathfinder: { goto: async () => { moved++; }, setGoal() {} }, stopDigging() {}, deactivateItem() {}, clearControlStates() {},
    findBlock: () => tablePresent ? table : null, blockAt: () => table,
    recipesFor: (id, meta, count, t) => (!requiresTable || t) && ingredients >= Math.ceil(count / 4) * 2 ? [recipe] : [],
    craft: async (r, times, t) => { assert.equal(times, 1); assert.equal(Boolean(t), requiresTable); ingredients -= 2; if (confirm) crafted++; }
  };
  return { bot, adapter: createMineflayerAdapter(bot, { goals: { GoalNear: class {}, GoalLookAtBlock: class {} } }), count: () => crafted, moved: () => moved };
}
test('Mineflayer crafts by recipe repetitions and checks actual inventory (mock API)', async () => {
  const fixture = craftBot();
  await fixture.adapter.execute({ skill: 'craft', args: { item: 'minecraft:stick', times: 2 } }, { signal: signal() });
  assert.equal(fixture.count(), 2); assert.equal(fixture.moved(), 0);
  const unconfirmed = craftBot({ confirm: false });
  await assert.rejects(unconfirmed.adapter.execute({ skill: 'craft', args: { item: 'minecraft:stick' } }, { signal: signal() }), /не подтвердил/);
});
test('Mineflayer requires ingredients and walks to a real crafting table for table recipes', async () => {
  const fixture = craftBot({ requiresTable: true });
  await fixture.adapter.execute({ skill: 'craft', args: { item: 'stick' } }, { signal: signal() }); assert.equal(fixture.moved(), 1);
  const missing = craftBot({ requiresTable: true, tablePresent: false });
  await assert.rejects(missing.adapter.execute({ skill: 'craft', args: { item: 'stick' } }, { signal: signal() }), /нет верстака/);
  const insufficient = craftBot({ ingredients: 2 });
  await assert.rejects(insufficient.adapter.execute({ skill: 'craft', args: { item: 'stick', times: 2 } }, { signal: signal() })); assert.equal(insufficient.count(), 0);
});
test('craft cancellation waits for current transaction and never starts next repetition', async () => {
  const fixture = craftBot(), entered = deferred(), finish = deferred(), ac = new AbortController(); let calls = 0;
  fixture.bot.craft = async () => { calls++; entered.resolve(); await finish.promise; };
  const action = fixture.adapter.execute({ skill: 'craft', args: { item: 'stick', times: 2 } }, { signal: ac.signal });
  await entered.promise; ac.abort(); let settled = false; action.catch(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); finish.resolve(); await assert.rejects(action); assert.equal(calls, 1);
});

test('Mineflayer gather waits for the delayed inventory pickup after reaching the block', async () => {
  let mined = false, amount = 0;
  const block = { name: 'oak_log', type: 1, position: { x: 1, y: 64, z: 0 }, canHarvest: () => true };
  const bot = { health: 20, entity: { position: { x: 0, y: 64, z: 0 } }, world: {},
    inventory: { emptySlotCount: () => 10, items: () => amount ? [{ name: 'oak_log', count: amount }] : [] },
    pathfinder: { movements: { canDig: false, safeToBreak: () => true }, bestHarvestTool: () => null, setGoal() {}, goto: async () => {} },
    findBlock: () => block, blockAt: () => mined ? { type: 0 } : block,
    dig: async () => { mined = true; setTimeout(() => { amount = 1; }, 80); },
    stopDigging() {}, deactivateItem() {}, clearControlStates() {}
  };
  const adapter = createMineflayerAdapter(bot, { goals: { GoalNear: class {}, GoalLookAtBlock: class {} } });
  await adapter.execute({ skill: 'gather', args: { block: 'minecraft:oak_log', count: 1 } }, { signal: signal() });
  assert.equal(amount, 1);
});

test('world changed while planner awaited: no stale action executes before fresh observation', async () => {
  const sim = createSimulator(); let changed = false, executed = 0;
  const base = createSymbolicPlanner();
  const core = createCore({ config: { ...config, rules: [] }, adapter: { ...sim,
    observe: async ctx => { const o = await sim.observe(ctx); if (changed) o.world.nearbyBlocks['minecraft:oak_log'] = false; return o; },
    execute: async () => { executed++; }
  }, planning: planning({ planner: { id: 'slow', apiVersion: 1, async plan(c, ctx) { const p = await base.plan(c, ctx); changed = true; return p; } } }) });
  const state = await core.tick(); assert.equal(executed, 0); assert.equal(state.trace.selected, null); assert.match(state.reason, /Мир изменился/);
});
