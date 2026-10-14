import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentManager, startDashboard } from '../overmindmc.js';

function fixture(memoryDirectory, names = ['Atlas']) {
  let stops = 0, closes = 0;
  const manager = createAgentManager({ count: names.length, names, memoryDirectory, worldId: 'shutdown',
    createClient: () => Object.assign(new EventEmitter(), {
      state: { status: 'ready' }, inventory: { items: () => [] },
      describe: () => ({ skills: [] }), snapshot: () => ({}),
      async close() { closes++; this.state.status = 'disconnected'; }
    }),
    createBrain: () => ({ start() {}, snapshot: () => ({}), async stop() { stops++; } })
  });
  return { manager, counts: () => ({ stops, closes }) };
}

test('a memory write failure cannot leave a Minecraft connection open', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mckudo-shutdown-'));
  const blocked = join(directory, 'not-a-directory');
  const { manager, counts } = fixture(blocked);
  try {
    await manager.execute('Atlas', 'start');
    // Fail saving after a valid load; Linux and Windows differ on ENOTDIR/ENOENT.
    await writeFile(blocked, 'A file prevents memory directory creation.');
    const closing = manager.close();
    assert.equal(manager.close(), closing);
    await assert.rejects(closing, error => error instanceof AggregateError && error.errors.length > 0);
    assert.deepEqual(counts(), { stops: 1, closes: 1 });
    await assert.rejects(manager.execute('Atlas', 'start'), /closed/);
    await assert.rejects(manager.execute('Atlas', 'pause'), /closed/);
  } finally { await manager.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
});

test('one failed brain stop does not prevent other agents or sockets from closing', async () => {
  const { manager, counts } = fixture(undefined, ['Atlas', 'Blake']);
  await manager.execute('Atlas', 'start');
  await manager.execute('Blake', 'start');
  manager.entries.get('Atlas').brain.stop = async () => { throw new Error('stop failed'); };
  await assert.rejects(manager.close(), error => error.errors[0].message === 'stop failed');
  assert.equal(counts().closes, 2);
  assert.equal(counts().stops, 1);
});

test('dashboard releases its port even if manager shutdown fails', async () => {
  let closes = 0;
  const dashboard = await startDashboard({ port: 0, manager: {
    ready: Promise.resolve(), snapshot: () => ({}), async close() { closes++; throw new Error('memory unavailable'); }
  } });
  const closing = dashboard.close();
  assert.equal(dashboard.close(), closing);
  await assert.rejects(closing, /memory unavailable/);
  assert.equal(dashboard.server.listening, false);
  assert.equal(closes, 1);
});
