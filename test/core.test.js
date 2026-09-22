import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, validateConfig, ConfigError, matches, MCKUDO } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';
import { createBridgeAdapter } from '../adapters/bridge.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
import { FileMemory } from '../src/file-memory.js';
const sample = JSON.parse(await readFile(new URL('../examples/agent.json', import.meta.url), 'utf8'));
const config = (overrides = {}) => ({ schemaVersion: 1, name: 'Test', worldId: 'test', rules: [{ id: 'work', action: { skill: 'work' } }], ...overrides });
const adapter = (overrides = {}) => ({ describe: () => ({ protocolVersion: 1, kind: 'test', loader: 'vanilla', minecraftVersion: 'test', skills: ['work'] }), observe: async () => ({ self: { health: 20, food: 20, position: { x: 0, z: 0 } } }), execute: async () => ({ ok: true }), ...overrides });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('public API runs a complete JSON plan and preserves author', async () => {
  const core = createCore({ config: sample, adapter: createSimulator() });
  for (let n = 0; n < 7; n++) await core.tick();
  const state = core.snapshot();
  assert.equal(state.observation.inventory['minecraft:oak_log'], 4);
  assert.equal(state.observation.self.food, 17); assert.equal(state.status, 'idle');
  assert.equal(state.history.length, 5); assert.equal(MCKUDO.author, 'y9kudo');
});
test('configuration reports the exact typo, rejects duplicate rules and invalid priorities', () => {
  assert.throws(() => validateConfig(config({ tickIntervaMs: 100 })), e => e instanceof ConfigError && e.path === '$.tickIntervaMs');
  assert.throws(() => validateConfig(config({ rules: [config().rules[0], config().rules[0]] })), /уникальный/);
  assert.throws(() => validateConfig(config({ rules: [{ id: 'x', priority: 1.5, action: { skill: 'work' } }] })), /priority/);
});
test('JSON rejects functions, cycles, prototypes, excess depth and unsafe fields', () => {
  assert.throws(() => validateConfig(config({ rules: [{ id: 'x', action: { skill: 'work', args: { code: () => 1 } } }] })), /JSON/);
  const cycle = {}; cycle.x = cycle;
  assert.throws(() => validateConfig(config({ rules: [{ id: 'x', action: { skill: 'work', args: cycle } }] })), /циклический/);
  assert.throws(() => validateConfig(JSON.parse('{"__proto__":{}}')), /зарезервированное/);
  let condition = { fact: '/x', eq: 1 }; for (let i = 0; i < 10; i++) condition = { not: condition };
  assert.throws(() => validateConfig(config({ rules: [{ id: 'x', when: condition, action: { skill: 'work' } }] })), /вложено/);
});
test('conditions use typed comparisons, escaped JSON Pointer and explicit missing facts', () => {
  const observation = { n: 5, text: '5', 'mod:item/key': 2 };
  for (const [op, expected] of [['lt', false], ['lte', true], ['gt', false], ['gte', true], ['eq', true], ['ne', false]]) assert.equal(matches({ fact: '/n', [op]: 5 }, observation), expected);
  assert.equal(matches({ fact: '/text', lt: 6 }, observation), false);
  assert.equal(matches({ fact: '/mod:item~1key', eq: 2 }, observation), true);
  assert.equal(matches({ fact: '/missing', ne: 0 }, observation), false);
  assert.equal(matches({ fact: '/missing', exists: false }, observation), true);
  assert.equal(matches({ fact: '/constructor', exists: true }, observation), false);
  assert.equal(matches({ all: [{ fact: '/n', eq: 5 }, { any: [{ fact: '/n', eq: 8 }, { not: { fact: '/n', eq: 9 } }] }] }, observation), true);
});
test('unsupported skills are blocked instead of being reported as success', async () => {
  let calls = 0;
  const core = createCore({ config: config(), adapter: adapter({ describe: () => ({ protocolVersion: 1, skills: [] }), execute: async () => { calls++; } }) });
  assert.equal((await core.tick()).status, 'blocked'); assert.equal(calls, 0);
  core.registerSkill('work', async () => { calls++; }); await core.tick(); assert.equal(calls, 1);
  assert.throws(() => core.registerSkill('work', async () => {}), /уже/);
});
test('concurrent and reentrant ticks share a lock and never overlap actions', async () => {
  const gate = deferred(), entered = deferred(); let calls = 0, again;
  const core = createCore({ config: config(), adapter: adapter({ execute: async () => { calls++; entered.resolve(); await gate.promise; } }) });
  core.once('action:start', () => { again = core.tick(); });
  const one = core.tick(), two = core.tick(); assert.equal(one, two); await entered.promise;
  assert.equal(calls, 1); assert.equal(again, one); gate.resolve(); await one;
});
test('pause waits for action cancellation before another action may start', async () => {
  const entered = deferred(); let stopped = false;
  const core = createCore({ config: config(), adapter: adapter({ execute: async (_, { signal }) => {
    entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true }));
  } }) });
  const pending = core.tick(); await entered.promise; await core.pause(); await pending;
  assert.equal(stopped, true); assert.equal(core.snapshot().lastResult.outcome, 'cancelled');
  assert.deepEqual(core.exportMemory().stats, {}); assert.equal((await core.tick()).paused, true);
});
test('timeout is a failure and triggers local backoff; leaving the area allows retry', async () => {
  let now = 1000, x = 0, calls = 0;
  const core = createCore({ config: config({ actionTimeoutMs: 100, failureBackoffMs: 1000 }), clock: () => now, adapter: adapter({
    observe: async () => ({ self: { position: { x, z: 0 } } }),
    execute: async (_, { signal }) => { calls++; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); },
  }) });
  assert.equal((await core.tick()).lastResult.outcome, 'failure');
  assert.equal((await core.tick()).status, 'blocked'); assert.equal(calls, 1);
  x = 32; await core.tick(); assert.equal(calls, 2);
  x = 0; now += 1001; await core.tick(); assert.equal(calls, 3);
});
test('success resets failure streak, snapshots and memory do not leak mutable internals', async () => {
  let now = 0, fail = true;
  const core = createCore({ config: config({ failureBackoffMs: 100 }), clock: () => now, adapter: adapter({ execute: async () => ({ ok: !fail }) }) });
  await core.tick(); now += 101; fail = false; await core.tick();
  const memory = core.exportMemory(); assert.equal(memory.stats.work.streak, 0);
  memory.stats.work.successes = 999; assert.equal(core.exportMemory().stats.work.successes, 1);
  const snapshot = core.snapshot(); snapshot.history.length = 0; assert.equal(core.snapshot().history.length, 2);
});
test('memory separates worlds and bounds history', async () => {
  const c = createCore({ config: config({ maxHistory: 2 }), adapter: adapter() });
  for (let i = 0; i < 5; i++) await c.tick();
  const restored = createCore({ config: config(), adapter: adapter(), memory: c.exportMemory() });
  assert.equal(restored.snapshot().history.length, 2);
  assert.throws(() => createCore({ config: config({ worldId: 'another' }), adapter: adapter(), memory: c.exportMemory() }), /другого мира/);
});
test('rule names cannot accidentally resolve Object.prototype counters', async () => {
  const c = createCore({ config: config({ rules: [{ id: 'toString', action: { skill: 'work' } }] }), adapter: adapter() });
  await c.tick(); const saved = c.exportMemory();
  assert.equal(saved.stats.toString.successes, 1);
  const restored = createCore({ config: config({ rules: [{ id: 'toString', action: { skill: 'work' } }] }), adapter: adapter(), memory: saved });
  await restored.tick(); assert.equal(restored.exportMemory().stats.toString.successes, 2);
});
test('file memory round-trips and leaves malformed files untouched', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mckudo-core-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'memory.json'), memory = new FileMemory(file);
  assert.equal(await memory.load(), undefined);
  const core = createCore({ config: config(), adapter: adapter() }); await core.tick();
  await memory.save(core.exportMemory()); assert.deepEqual(await memory.load(), core.exportMemory());
  await writeFile(file, 'broken'); await assert.rejects(memory.load()); assert.equal(await readFile(file, 'utf8'), 'broken');
});
for (const loader of ['forge', 'neoforge', 'fabric']) test(`bridge negotiates ${loader} and handles namespaced mod skills (mock transport)`, async () => {
  let received;
  const bridge = await createBridgeAdapter({ expectedLoader: loader, transport: {
    describe: async () => ({ protocolVersion: 1, loader, minecraftVersion: '26.2', skills: ['create:press'] }),
    observe: async () => ({ inventory: { 'create:brass_ingot': 4 } }),
    execute: async request => { received = request; return { ok: true }; }, cancel: async () => ({ stopped: true }),
  } });
  const c = createCore({ config: config({ rules: [{ id: 'press', when: { fact: '/inventory/create:brass_ingot', gt: 0 }, action: { skill: 'create:press' } }] }), adapter: bridge });
  await c.tick(); assert.equal(received.action.skill, 'create:press'); assert.ok(received.requestId); assert.equal(c.snapshot().lastResult.outcome, 'success');
});
test('bridge rejects loader mismatch, quarantines unconfirmed cancellation and lost acknowledgement', async () => {
  const description = { protocolVersion: 1, loader: 'forge', minecraftVersion: '26.3', skills: ['work'] };
  const base = { describe: async () => description, observe: async () => ({}), execute: async () => ({ ok: true }), cancel: async () => ({ stopped: true }) };
  await assert.rejects(createBridgeAdapter({ expectedLoader: 'neoforge', transport: base }), /несовместимый/);
  const entered = deferred(), finished = deferred();
  const bridge = await createBridgeAdapter({ expectedLoader: 'forge', transport: { ...base,
    execute: async () => { entered.resolve(); return finished.promise; }, cancel: async () => { finished.resolve({ ok: false }); return { stopped: false }; },
  } });
  const ac = new AbortController(), pending = bridge.execute({ skill: 'work', args: {} }, { signal: ac.signal });
  await entered.promise; ac.abort(); await assert.rejects(pending);
  await assert.rejects(bridge.observe({ signal: new AbortController().signal }), /не подтверждена/);
  const lost = await createBridgeAdapter({ expectedLoader: 'forge', transport: { ...base, execute: async () => { throw new Error('Connection lost'); } } });
  await assert.rejects(lost.execute({ skill: 'work' }, { signal: new AbortController().signal }));
  await assert.rejects(lost.observe({ signal: new AbortController().signal }), /не подтверждена/);
});
test('Mineflayer adapter supports real API shape, zero counts and cancellation (mock bot)', async () => {
  const entered = deferred(); let cancelled = false, finish;
  const b = { version: 'test', health: 20, food: 10, entity: { position: { x: 0, y: 64, z: 0 } },
    registry: { itemsByName: { bread: {}, oak_log: {} } }, inventory: { items: () => [{ name: 'bread', count: 2 }] }, game: { dimension: 'overworld' },
    pathfinder: { goto: async () => { entered.resolve(); await new Promise(r => { finish = r; }); }, setGoal: () => { cancelled = true; finish?.(); } },
    stopDigging() {}, deactivateItem() {}, clearControlStates() {},
  };
  const a = createMineflayerAdapter(b, { goals: { GoalNear: class {}, GoalLookAtBlock: class {} } });
  const signal = new AbortController(); const o = await a.observe({ signal: signal.signal }); assert.equal(o.inventory['minecraft:oak_log'], 0);
  const move = a.execute({ skill: 'goto', args: { x: 1, y: 64, z: 2 } }, { signal: signal.signal });
  await entered.promise; signal.abort(); await assert.rejects(move); assert.equal(cancelled, true);
  await assert.rejects(a.execute({ skill: 'gather', args: { block: 'create:copper_ore' } }, { signal: new AbortController().signal }), /bridge/);
});
