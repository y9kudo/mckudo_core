import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCore, validateConfig, definePlugin, MckudoRuntime } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';
const workshop = JSON.parse(await readFile(new URL('../examples/workshop.json', import.meta.url), 'utf8'));
const config = (steps, extra = {}) => ({ schemaVersion: 2, name: 'Test', worldId: 'test', workflows: [{ id: 'mission', steps }], ...extra });
const step = (id, extra = {}) => ({ id, action: { skill: 'work', args: { id } }, ...extra });
const adapter = (options = {}) => ({ describe: () => ({ protocolVersion: 1, kind: 'mock', loader: 'vanilla', minecraftVersion: 'test', skills: ['work'] }),
  observe: async () => ({}), execute: async () => ({ ok: true }), ...options });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('schema 1 remains valid after normalization; schema 2 needs actual work', () => {
  const old = { schemaVersion: 1, name: 'Old', worldId: 'test', rules: [{ id: 'r', action: { skill: 'work' } }] };
  assert.deepEqual(validateConfig(validateConfig(old)), validateConfig(old));
  assert.throws(() => validateConfig({ schemaVersion: 2, name: 'Empty', worldId: 'test' }), /хотя бы/);
  assert.throws(() => validateConfig({ ...config([step('a')]), schemaVersion: 1, rules: old.rules }), /schemaVersion/);
});
test('workflow validator catches cycles, dangling dependencies, duplicate IDs and retry bounds', () => {
  for (const steps of [
    [step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })],
    [step('a', { dependsOn: ['unknown'] })], [step('a'), step('a')],
    [step('a', { maxAttempts: 0 })], [step('a', { retryDelayMs: 0 })],
  ]) assert.throws(() => validateConfig(config(steps)));
});
test('workshop reaches its actual resource postconditions and completes once', async () => {
  const c = createCore({ config: workshop, adapter: createSimulator() });
  for (let n = 0; n < 12; n++) await c.tick();
  const s = c.snapshot(); assert.equal(s.workflows[0].status, 'completed'); assert.equal(s.workflows[0].completed, 4);
  assert.equal(s.observation.inventory['minecraft:crafting_table'], 1); assert.equal(s.observation.inventory['minecraft:stick'], 4);
  assert.equal(s.history.length, 6); assert.equal(s.history[1].outcome, 'progress');
});
test('dependencies can point forward in JSON; pre-satisfied steps skip execution', async () => {
  const calls = [];
  const c = createCore({ config: config([
    step('consumer', { dependsOn: ['producer'] }),
    step('producer', { dependsOn: [], until: { fact: '/ready', eq: true } }),
  ]), adapter: adapter({ observe: async () => ({ ready: true }), execute: async a => { calls.push(a.args.id); } }) });
  await c.tick(); assert.deepEqual(calls, ['consumer']); assert.equal(c.snapshot().workflows[0].status, 'completed');
});
test('workflow activation is remembered after its trigger becomes false', async () => {
  let active = true; const calls = [];
  const cfg = config([step('a'), step('b')]); cfg.workflows[0].when = { fact: '/trigger', eq: true };
  const c = createCore({ config: cfg, adapter: adapter({ observe: async () => ({ trigger: active }), execute: async a => { calls.push(a.args.id); active = false; } }) });
  await c.tick(); await c.tick(); assert.deepEqual(calls, ['a', 'b']);
});
test('higher priority reactive rule runs between workflow steps', async () => {
  let hungry = false; const calls = [];
  const c = createCore({ config: config([step('a'), step('b')], { rules: [{ id: 'refuel', priority: 100, when: { fact: '/hungry', eq: true }, action: { skill: 'work', args: { id: 'refuel' } } }] }),
    adapter: adapter({ observe: async () => ({ hungry }), execute: async a => { calls.push(a.args.id); hungry = a.args.id === 'a'; } }) });
  await c.tick(); await c.tick(); await c.tick(); assert.deepEqual(calls, ['a', 'refuel', 'b']);
});
test('failed steps honor backoff, exhaust retries and hold dependents until explicit retry', async () => {
  let now = 0, fails = true; const calls = [];
  const c = createCore({ config: config([step('a', { maxAttempts: 2, retryDelayMs: 100 }), step('b')]), clock: () => now,
    adapter: adapter({ execute: async a => { calls.push(a.args.id); if (a.args.id === 'a' && fails) throw new Error('Unavailable'); } }) });
  await c.tick(); await c.tick(); assert.deepEqual(calls, ['a']);
  now = 101; await c.tick(); assert.equal(c.snapshot().workflows[0].status, 'failed');
  now = 1000; await c.tick(); assert.deepEqual(calls, ['a', 'a']);
  fails = false; c.retryStep('mission', 'a'); await c.tick(); await c.tick(); assert.deepEqual(calls, ['a', 'a', 'a', 'b']);
});
test('unachieved postcondition never counts as completed and is bounded by maxAttempts', async () => {
  const c = createCore({ config: config([step('a', { maxAttempts: 2, until: { fact: '/ready', eq: true } }), step('b')]), adapter: adapter({ observe: async () => ({ ready: false }) }) });
  await c.tick(); await c.tick(); await c.tick();
  const w = c.snapshot().workflows[0]; assert.equal(w.status, 'failed'); assert.equal(w.steps.a.attempts, 2); assert.equal(w.steps.b.attempts, 0);
});
test('save and restore resumes unfinished steps without replaying completed actions', async () => {
  const cfg = config([step('a'), step('b')]), calls = [], a = adapter({ execute: async action => { calls.push(action.args.id); } });
  const first = createCore({ config: cfg, adapter: a }); await first.tick();
  const second = createCore({ config: cfg, adapter: a, memory: first.exportMemory() }); await second.tick();
  assert.deepEqual(calls, ['a', 'b']); assert.equal(second.snapshot().workflows[0].status, 'completed');
});
test('an in-flight checkpoint becomes interrupted and requires an explicit decision', async () => {
  const entered = deferred(), gate = deferred(); const cfg = config([step('a')]);
  const first = createCore({ config: cfg, adapter: adapter({ execute: async () => { entered.resolve(); await gate.promise; } }) });
  const job = first.tick(); await entered.promise; const memory = first.exportMemory(); gate.resolve(); await job;
  let count = 0;
  const restored = createCore({ config: cfg, memory, adapter: adapter({ execute: async () => { count++; } }) });
  await restored.tick(); assert.equal(count, 0); assert.equal(restored.snapshot().workflows[0].status, 'interrupted');
  restored.retryStep('mission', 'a'); await restored.tick(); assert.equal(count, 1);
});
test('changed workflow definitions and malformed step memory are rejected', async () => {
  const cfg = config([step('a')]), c = createCore({ config: cfg, adapter: adapter() }); await c.tick();
  const m = c.exportMemory();
  assert.throws(() => createCore({ config: config([step('a'), step('b')]), adapter: adapter(), memory: m }), /Изменилась/);
  m.workflows.mission.steps.a.attempts = -1;
  assert.throws(() => createCore({ config: cfg, adapter: adapter(), memory: m }), /Повреждён/);
});
test('reordering JSON object keys preserves saved workflow compatibility', async () => {
  const cfg = config([step('a')]), first = createCore({ config: cfg, adapter: adapter() }); await first.tick();
  const reordered = { ...cfg, workflows: [{ steps: [{ action: { args: { id: 'a' }, skill: 'work' }, id: 'a' }], id: 'mission' }] };
  const next = createCore({ config: reordered, adapter: adapter(), memory: first.exportMemory() });
  assert.equal(next.snapshot().workflows[0].status, 'completed');
});
test('workflow cancellation does not use up retry budget; reset is explicit', async () => {
  const entered = deferred(); let cancel = true, calls = 0;
  const c = createCore({ config: config([step('a', { maxAttempts: 1 })]), adapter: adapter({ execute: async (_, { signal }) => {
    calls++; entered.resolve(); if (cancel) await new Promise(r => signal.addEventListener('abort', r, { once: true }));
  } }) });
  const job = c.tick(); await entered.promise;
  assert.throws(() => c.resetWorkflow('mission'), /дождись/);
  await c.pause(); await job; assert.equal(c.snapshot().workflows[0].steps.a.attempts, 0);
  cancel = false; c.resume(); await c.tick(); c.resetWorkflow('mission'); await c.tick(); assert.equal(calls, 3);
});
test('plugins register atomically, enforce dependencies and prevent unsafe removal', async () => {
  const c = createCore({ config: config([step('a')]), adapter: adapter() });
  const dependency = definePlugin({ id: 'base', apiVersion: 1, skills: { helper: async () => {} } });
  const dependent = { id: 'tools', apiVersion: 1, requires: ['base'], skills: { drill: async () => {} } };
  assert.throws(() => c.use(dependent), /Сначала/); c.use(dependency).use(dependent);
  assert.throws(() => c.removePlugin('base'), /зависят/);
  assert.throws(() => c.use({ id: 'bad', apiVersion: 1, skills: { fresh: async () => {}, work: async () => {} } }), /уже/);
  c.registerSkill('fresh', async () => {});
  c.removePlugin('tools').removePlugin('base'); assert.deepEqual(c.snapshot().plugins, []);
});
test('plugin argument validation prevents execution and declared capability enables a workflow', async () => {
  let called = 0;
  const c = createCore({ config: config([{ id: 'custom', action: { skill: 'tools:press', args: { count: 0 } }, maxAttempts: 1 }]), adapter: adapter() });
  assert.equal((await c.tick()).status, 'blocked');
  c.use({ id: 'tools', apiVersion: 1, skills: { 'tools:press': { validate: args => args.count > 0 || 'count должен быть больше нуля.', execute: async () => { called++; } } } });
  await c.tick(); assert.equal(called, 0); assert.equal(c.snapshot().workflows[0].status, 'failed');
});
test('throwing and async event subscribers cannot duplicate successful game actions', async () => {
  let calls = 0;
  const c = createCore({ config: config([step('a')]), adapter: adapter({ execute: async () => { calls++; } }) });
  c.on('action:finish', () => { throw new Error('UI failed'); });
  c.on('state', async () => { throw new Error('Network failed'); });
  await c.tick(); await c.tick(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(c.snapshot().history.length, 1); assert.equal(c.snapshot().history[0].outcome, 'success');
  assert.ok(c.snapshot().listenerErrors.some(e => e.message === 'UI failed'));
});
test('runtime limits concurrent agents and preserves isolated workflow state', async () => {
  let active = 0, peak = 0; const batch = new MckudoRuntime({ concurrency: 2 });
  for (let n = 0; n < 5; n++) batch.add('a' + n, createCore({ config: config([step('a')], { worldId: 'world-' + n }), adapter: adapter({ execute: async () => {
    active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--;
  } }) }), { resourceKey: 'player:' + n });
  const one = batch.tick(), two = batch.tick(); assert.equal(one, two); await one;
  assert.equal(peak, 2); assert.equal(Object.keys(batch.snapshot().agents).length, 5);
  assert.ok(Object.values(batch.snapshot().agents).every(s => s.workflows[0].status === 'completed'));
  await batch.stop();
});
test('runtime rejects duplicate physical resources and does not start queued agents after pause', async () => {
  const entered = deferred(); let calls = 0;
  const make = () => createCore({ config: config([step('a')]), adapter: adapter({ execute: async (_, { signal }) => { calls++; entered.resolve(); await new Promise(r => signal.addEventListener('abort', r, { once: true })); } }) });
  const runtime = new MckudoRuntime({ concurrency: 1 }), first = make();
  runtime.add('first', first, { resourceKey: 'connection:1' });
  assert.throws(() => runtime.add('copy', make(), { resourceKey: 'connection:1' }), /занят/);
  assert.throws(() => runtime.add('same-core', first), /занят/);
  runtime.add('second', make()); const task = runtime.tick(); await entered.promise;
  await runtime.pause(); await task; assert.equal(calls, 1); assert.equal(runtime.snapshot().paused, true);
});
test('CLI initializes a standalone workspace, validates workflows and never overwrites it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mckudo-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url)), destination = join(dir, 'new-project');
  execFileSync(process.execPath, [cli, 'init', destination]);
  const text = await readFile(join(destination, 'agent.json'), 'utf8'); assert.equal(JSON.parse(text).schemaVersion, 2);
  assert.match(execFileSync(process.execPath, [cli, 'validate', join(destination, 'agent.json')], { encoding: 'utf8' }), /корректен/);
  assert.equal(spawnSync(process.execPath, [cli, 'init', destination]).status, 1);
  assert.equal(await readFile(join(destination, 'agent.json'), 'utf8'), text);
  const demo = spawnSync(process.execPath, [cli, 'simulate', join(destination, 'agent.json'), '--steps', '10'], { encoding: 'utf8' });
  assert.equal(demo.status, 0, demo.stderr); assert.match(demo.stdout, /completed/);
});
