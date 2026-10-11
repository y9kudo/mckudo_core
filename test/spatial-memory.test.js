import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { createSpatialMemory, createSurvivalReactor, catalogFromMinecraftData } from '../mckudo_core.js';

const overworld = 'minecraft:overworld', nether = 'minecraft:the_nether';
const block = (x, name = 'minecraft:birch_log') => ({ name, position: { x, y: 64, z: 0 } });
const observation = (dimension, blocks) => ({ dimension, world: { sampledBlocks: blocks } });

test('spatial memory persists evidence by world and dimension, expires and protects snapshots', () => {
  let now = 1000;
  const atlas = createSpatialMemory({ worldId: 'a', clock: () => now, maxAgeMs: 1000 });
  atlas.observe(observation(overworld, [block(5)])); atlas.observe(observation(nether, [block(5, 'minecraft:ancient_debris')]));
  const saved = atlas.export(), restored = createSpatialMemory({ worldId: 'a', memory: saved, clock: () => now, maxAgeMs: 1000 });
  saved.entries[0].name = 'minecraft:air';
  assert.equal(restored.entries({ dimension: overworld })[0].name, 'minecraft:birch_log');
  assert.equal(restored.entries({ dimension: nether })[0].name, 'minecraft:ancient_debris');
  assert.throws(() => createSpatialMemory({ worldId: 'b', memory: atlas.export() }), /другого мира/);
  now += 1001; assert.equal(restored.entries().length, 0);
});

test('unknown blocks preserve hints while visible contradictions revoke them; capacity is bounded', () => {
  const atlas = createSpatialMemory({ worldId: 'test', maxEntries: 16 });
  atlas.observe(observation(overworld, Array.from({ length: 30 }, (_, i) => block(i))));
  assert.equal(atlas.snapshot().entries, 16);
  atlas.observe(observation(overworld, []), { getBlock: () => null }); assert.equal(atlas.snapshot().entries, 16);
  atlas.observe(observation(overworld, []), { getBlock: () => ({ name: 'air' }) });
  assert.equal(atlas.snapshot().entries, 0); assert.equal(atlas.snapshot().invalidations, 16);
  atlas.observe(observation(overworld, [block(20)]), { getBlock: () => ({ name: 'air' }) });
  assert.equal(atlas.snapshot().entries, 0, 'stale observation must not reintroduce a disproved block');
});

test('survival explores toward a remembered unloaded tree and never digs unknown blocks', () => {
  const atlas = createSpatialMemory({ worldId: 'test' }); atlas.observe(observation(overworld, [block(100)]));
  const catalog = catalogFromMinecraftData(minecraftData('1.21.1'));
  const air = { name: 'air', shapes: [], boundingBox: 'empty' }, stone = { name: 'stone', shapes: [[0,0,0,1,1,1]], boundingBox: 'block' };
  const client = { world: { blockAt: p => Math.abs(p.x) > 30 || Math.abs(p.z) > 30 ? null : p.y < 64 ? stone : air } };
  const reactor = createSurvivalReactor({ catalog, client, spatial: atlas, targets: { '#logs': 1 }, digStaircase: false });
  const result = reactor.react({ ...observation(overworld, []), self: { position: { x: 0, y: 64, z: 0 }, health: 20 }, inventory: {} });
  assert.equal(result.action.skill, 'navigate'); assert.ok(result.action.args.x > 0 && result.action.args.x <= 24);
});
