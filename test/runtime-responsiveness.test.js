import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { createCore, createSurvivalReactor, catalogFromMinecraftData } from '../overmindmc.js';
import { createOMAdapter } from '../adapters/omconnect.js';
import { OMConnect } from '../omconnect/index.js';

const observation = { dimension: 'minecraft:overworld', self: { position: { x: 0, y: 64, z: 0 }, health: 20 }, inventory: {}, world: { sampledBlocks: [1, 2].map(x => ({ name: 'minecraft:birch_log', position: { x, y: 64, z: 0 } })) } };
const config = { schemaVersion: 4, name: 'Responsive', worldId: 'test', rules: [], failureBackoffMs: 1000 };
const catalog = catalogFromMinecraftData(minecraftData('1.21.1'));

test('survival can immediately choose another tree after a failed dig through the real core', async () => {
  const survival = createSurvivalReactor({ catalog, target: 'wood', exploration: false, clock: () => 100 });
  const actions = [], core = createCore({ config, reactors: [survival], clock: () => 100, adapter: {
    describe: () => ({ protocolVersion: 1, skills: ['dig', 'craft'] }), observe: async () => observation,
    execute: async action => { actions.push(action); return { ok: false, message: 'blocked face' }; }
  } });
  const detach = survival.attach(core);
  try { await core.tick(); await core.tick(); assert.deepEqual(actions.map(a => a.args.x), [1, 2]); }
  finally { detach(); await core.stop(); }
});

test('scoped failure still blocks the same action regardless of JSON key order; legacy scope is unchanged', async () => {
  for (const failureScope of ['action', 'reactor']) {
    let args = { x: 1, y: 2 }, calls = 0;
    const core = createCore({ config, clock: () => 100, reactors: [{ id: 'test', apiVersion: 1, failureScope,
      react: () => ({ action: { skill: 'dig', args }, priority: 1, reason: 'work' }) }], adapter: {
      describe: () => ({ protocolVersion: 1, skills: ['dig'] }), observe: async () => observation,
      execute: async () => { calls++; return { ok: false }; }
    } });
    await core.tick(); args = { y: 2, x: 1 }; await core.tick(); assert.equal(calls, 1);
    args = { y: 2, x: 2 }; await core.tick(); assert.equal(calls, failureScope === 'action' ? 2 : 1);
    await core.stop();
  }
});

test('adapter caches immutable item IDs but observes fresh inventory counts', async () => {
  const client = new OMConnect(); Object.assign(client.state, { position: { x: .5, y: 64, z: .5 }, health: 20, food: 20, dimension: 'minecraft:overworld' });
  let lists = 0, inventory = {};
  const observe = client.observe.bind(client);
  client.observe = () => ({ ...observe(), inventory });
  const adapter = createOMAdapter(client, { trackedBlocks: [], catalog: { ...catalog, items: () => { lists++; return catalog.items(); } } });
  const signal = new AbortController().signal;
  const first = await adapter.observe({ signal }); first.inventory['minecraft:birch_log'] = 99;
  inventory = { 'minecraft:birch_log': 3 };
  assert.equal((await adapter.observe({ signal })).inventory['minecraft:birch_log'], 3);
  inventory = {};
  assert.equal((await adapter.observe({ signal })).inventory['minecraft:birch_log'], 0);
  assert.equal(lists, 1); adapter.dispose();
});
