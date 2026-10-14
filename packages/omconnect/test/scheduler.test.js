import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createWorkScheduler } from '../index.js';
import { OMWorld } from '../src/world.js';
import minecraftData from 'minecraft-data';

test('shared scheduler is fair, bounded, cancellable and cleans up generators', async () => {
  const scheduler = createWorkScheduler({ maxJobs: 2 }), order = []; let disposed = 0;
  function* job(id) { try { for (let n = 0; n < 4; n++) { order.push(id); yield; } return id; } finally { disposed++; } }
  const a = scheduler.submit(job('a'), { nodesPerSlice: 1 }), b = scheduler.submit(job('b'), { nodesPerSlice: 1 });
  await assert.rejects(scheduler.submit(job('overflow')), /full/);
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.deepEqual(order, ['a','b','a','b','a','b','a','b']); assert.equal(disposed, 2);
  const signal = new AbortController(); const cancelled = scheduler.submit(job('cancel'), { signal: signal.signal, nodesPerSlice: 1 });
  await immediate(); signal.abort(new Error('cancel-job')); await assert.rejects(cancelled, /cancel-job/);
  assert.equal(disposed, 3); assert.equal(scheduler.snapshot().pending, 0); assert.equal(scheduler.snapshot().cancelled, 1);
  scheduler.close(); await assert.rejects(scheduler.submit(job('closed')), /closed/);
});

test('one broken job cannot starve others and close rejects all queued jobs', async () => {
  const scheduler = createWorkScheduler();
  const bad = scheduler.submit((function* () { throw new Error('broken'); })());
  const good = scheduler.submit((function* () { yield; return 42; })());
  await assert.rejects(bad, /broken/); assert.equal(await good, 42);
  const pending = scheduler.submit((function* () { while (true) yield; })());
  scheduler.close(); await assert.rejects(pending, /closed/);
  assert.equal(scheduler.snapshot().pending, 0);
  assert.throws(() => createWorkScheduler({ budgetMs: Infinity }));
});

test('chunk read views ignore unrelated edits but detect changed, unloaded and newly loaded chunks', () => {
  const registry = minecraftData('1.21.1'), world = new OMWorld(registry);
  const makeColumn = () => new world.Chunk({ minY: -64, worldHeight: 384 });
  world.columns.set('0,0', makeColumn()); world.columns.set('10,0', makeColumn());
  const read = world.createReadView(), p = { x: 1, y: 64, z: 1 }; read.blockAt(p);
  world.update({ x: 161, y: 64, z: 1 }, registry.blocksByName.stone.defaultState); assert.equal(read.isCurrent(), true);
  world.update(p, registry.blocksByName.stone.defaultState); assert.equal(read.isCurrent(), false);
  const unload = world.createReadView(); unload.blockAt(p); world.unload(0, 0); assert.equal(unload.isCurrent(), false);
  const unknown = world.createReadView(); assert.equal(unknown.blockAt(p), null);
  world.columns.set('0,0', makeColumn()); assert.equal(unknown.isCurrent(), false);
  const dimension = world.createReadView(); world.reset('minecraft:the_nether'); assert.equal(dimension.isCurrent(), false);
});
