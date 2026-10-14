import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { planRoute, planRouteAsync } from '../index.js';
import { TickTiming } from '../src/timing.js';
import { executeNavigate } from '../src/movement.js';

const stone = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
const air = { name: 'air', boundingBox: 'empty', shapes: [] };
const flat = p => p.y < 1 ? stone : air;
const options = { start: { x: 0, y: 1, z: 0 }, goal: { x: 15, y: 1, z: 9 }, getBlock: flat, maxNodes: 300 };

test('time slicing preserves A* results, including unknown space, falls and bridges', async () => {
  for (const opts of [options,
    { ...options, getBlock: p => p.x > 3 ? null : flat(p) },
    { ...options, goal: { x: 3, y: 1, z: 0 }, bridgeBudget: 1, getBlock: p => p.x === 1 && p.y === 0 ? air : flat(p) },
    { ...options, start: { x: 0, y: 3, z: 0 }, goal: { x: 1, y: 1, z: 0 }, getBlock: p => p.x <= 0 && p.y < 3 ? stone : flat(p) }
  ]) assert.deepEqual(await planRouteAsync(opts, { nodesPerSlice: 1 }), planRoute(opts));
});

test('twenty searches let scheduled work run before all searches complete', async () => {
  let finished = 0, heartbeats = 0, running = true;
  const heartbeat = (async () => { while (running) { await immediate(); if (finished < 20) heartbeats++; } })();
  try {
    await Promise.all(Array.from({ length: 20 }, async () => {
      const result = await planRouteAsync({ ...options, goal: { x: 300, y: 1, z: 0 } }, { nodesPerSlice: 8 });
      assert.equal(result.status, 'blocked'); finished++;
    }));
    assert.ok(heartbeats > 2);
  } finally { running = false; await heartbeat; }
});

test('abort between slices stops block reads and rejects the pending route', async () => {
  const abort = new AbortController(); let reads = 0;
  const pending = planRouteAsync({ ...options, signal: abort.signal, getBlock: p => { reads++; return flat(p); } }, { nodesPerSlice: 1 });
  await immediate(); await immediate(); assert.ok(reads > 0);
  abort.abort(new Error('stop-search'));
  const before = reads; await assert.rejects(pending); await immediate(); assert.equal(reads, before);
  await assert.rejects(planRouteAsync({ ...options, signal: abort.signal }), /stop-search/);
});

test('changed world revision invalidates suspended routes rather than using stale blocks', async () => {
  let revision = 1;
  const pending = planRouteAsync(options, { nodesPerSlice: 1, getRevision: () => revision });
  await immediate(); await immediate(); revision++;
  await assert.rejects(pending, /world changed/i);
  await assert.rejects(planRouteAsync(options, { sliceMs: NaN }), /sliceMs/);
});

test('navigation stops old input and refuses a route if the player moved during planning', async () => {
  let stopped = false;
  const c = { state: { status: 'ready', health: 20, position: { x: .5, y: 1, z: .5 }, dimension: 'minecraft:overworld' },
    world: { blockAt: flat, revision: 1 }, metrics: { corrections: 0 }, entities: new Map(), stopMovement: () => { stopped = true; } };
  setImmediate(() => { c.state.position.x = 2.5; });
  await assert.rejects(executeNavigate(c, { x: 8, y: 1, z: 0, bridge: false }, new AbortController().signal), /Start position changed/);
  assert.equal(stopped, true);
});

test('scheduler telemetry distinguishes slow dispatch from cheap physics and stays bounded', () => {
  const timing = new TickTiming(); assert.equal(timing.snapshot().effectiveHz, null);
  timing.mark(0); timing.mark(50); timing.mark(250);
  assert.equal(timing.snapshot().maxIntervalMs, 200); assert.equal(timing.snapshot().delayedTicks, 1);
  for (let n = 1; n <= 200; n++) timing.mark(250 + n * 50);
  assert.equal(timing.snapshot().samples, 128); assert.equal(timing.snapshot().effectiveHz, 20);
  assert.equal(timing.snapshot().delayedTicks, 0);
  timing.reset(); assert.equal(timing.snapshot().samples, 0);
});
