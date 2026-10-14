import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { executeCollect } from '../src/collection.js';

function fixture() {
  const c = new EventEmitter(); let count = 0;
  c.state = { status: 'ready', health: 20, position: { x: .5, y: 1, z: .5 } };
  c.inventory = { count: () => count };
  c.entities = new Map([[2, { id: '2', name: 'item', item: { name: 'birch_log' }, position: { x: 2.5, y: 1, z: .5 } }]]);
  c.world = { blockAt: p => p.y < 1 ? { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] } : { name: 'air' } };
  c.stopMovement = () => { c.stopped = true; };
  return { c, give: () => { count++; c.emit('inventory'); }, args: { item: 'birch_log', entityId: '2', timeoutMs: 500 } };
}
test('collection cancels approach immediately when server inventory confirms pickup', async () => {
  const { c, give, args } = fixture(); let interrupted = false;
  const result = await executeCollect(c, args, new AbortController().signal, { navigate: async (_c, target, signal) => {
    assert.equal(target.bridge, false); assert.equal(target.maxDrop, 2);
    give(); interrupted = signal.aborted; signal.throwIfAborted();
  } });
  assert.equal(interrupted, true); assert.equal(result.gained, 1); assert.equal(result.serverConfirmed, true);
  assert.equal(c.listenerCount('inventory'), 0); assert.equal(c.stopped, true);
});
test('entity removal alone is failure; late inventory update can still confirm pickup', async () => {
  const first = fixture(); first.c.entities.clear();
  await assert.rejects(executeCollect(first.c, first.args, new AbortController().signal, { navigate: assert.fail }), /gone/);
  const second = fixture(); second.c.entities.clear();
  const result = executeCollect(second.c, second.args, new AbortController().signal, { navigate: assert.fail });
  await delay(60); second.give(); assert.equal((await result).gained, 1);
});
test('inventory confirmation at the deadline wins over route timeout', async () => {
  const { c, give, args } = fixture();
  const result = await executeCollect(c, { ...args, timeoutMs: 100 }, new AbortController().signal, { navigate: async () => {
    await delay(110); give(); throw new Error('movement timed out');
  } });
  assert.equal(result.serverConfirmed, true);
});
test('preemption is not swallowed by pickup and always removes listeners', async () => {
  const { c, args } = fixture(), abort = new AbortController();
  await assert.rejects(executeCollect(c, args, abort.signal, { navigate: async () => { abort.abort(new Error('defense')); throw abort.signal.reason; } }), /defense/);
  assert.equal(c.listenerCount('inventory'), 0); assert.equal(c.stopped, true);
});

test('a failed pickup approach tries a different reachable position instead of retrying the same one', async () => {
  const {c,give,args}=fixture(),attempts=[];
  const result=await executeCollect(c,args,new AbortController().signal,{navigate:async(_c,target)=>{
    const id=`${target.x},${target.y},${target.z}`;attempts.push(id);
    if(attempts.length===1)throw new Error('Player blocks this approach');
    assert.notEqual(id,attempts[0]);give();
  }});
  assert.equal(result.serverConfirmed,true);assert.equal(attempts.length,2);
});
