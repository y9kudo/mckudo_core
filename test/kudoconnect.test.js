import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import minecraftData from 'minecraft-data';
import { KudoConnect, KudoWorld, KudoInventory, stepPhysics, miningTime } from '../kudoconnect/index.js';
import { createKudoAdapter } from '../adapters/kudoconnect.js';
import { planRoute } from '../mckudo_core.js';
const registry = minecraftData('1.21.1');
const full = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }, air = { name: 'air', boundingBox: 'empty', shapes: [] };
const flat = p => p.y < 1 ? full : air;
const player = () => ({ position: { x: 0.5, y: 1, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 }, onGround: true });
test('offline transport validates its actual version/auth support before opening any socket', () => {
  assert.throws(() => new KudoConnect({ auth: 'microsoft' }), /offline/);
  assert.throws(() => new KudoConnect({ version: '1.20.4' }), /1.21.1/);
  assert.throws(() => new KudoConnect({ username: '../x' }), /параметры/);
  assert.equal(new KudoConnect().snapshot().identity.author, 'y9kudo');
});
test('own physics walks, lands on solid ground, collides with walls and freezes at unknown chunks', () => {
  let s = player();
  for (let i = 0; i < 20; i++) s = stepPhysics(s, { x: 1, z: 0 }, flat);
  assert.ok(s.position.x > 4 && s.position.x < 5.1); assert.equal(s.position.y, 1); assert.equal(s.onGround, true);
  const wall = p => p.x >= 2 && p.x < 3 && p.y >= 1 && p.y < 3 ? full : flat(p);
  s = player(); for (let i = 0; i < 20; i++) s = stepPhysics(s, { x: 1, z: 0 }, wall);
  assert.ok(s.position.x <= 1.7000001); assert.equal(s.horizontalCollision, true);
  assert.equal(stepPhysics(s, { x: 1, z: 0 }, () => null).frozen, true);
});
test('own physics performs a bounded jump and returns to the same floor', () => {
  let s = player(), highest = s.position.y;
  for (let i = 0; i < 30; i++) { s = stepPhysics(s, { jump: i === 0 }, flat); highest = Math.max(highest, s.position.y); }
  assert.ok(highest > 2 && highest < 2.3); assert.equal(s.position.y, 1); assert.equal(s.onGround, true);
});
test('chunk cache separates absent chunks from air, tracks server block changes and dimension reset', async () => {
  const world = new KudoWorld(registry), column = new world.Chunk({ minY: -64, worldHeight: 384 });
  assert.equal(world.blockAt({ x: 0, y: 64, z: 0 }), null);
  column.setBlockStateId({ x: 2, y: 64, z: 2 }, registry.blocksByName.birch_log.defaultState);
  column.setBlockStateId({ x: 10, y: 64, z: 2 }, registry.blocksByName.oak_log.defaultState);
  world.load({ x: 0, z: 0, chunkData: column.dump() });
  const result = await world.findBlocks({ names: ['oak_log', 'birch_log'], position: { x: 0.5, y: 64, z: 2.5 }, radius: 32 });
  assert.equal(result.blocks[0].name, 'minecraft:birch_log'); assert.equal(result.blocks.length, 2);
  world.update({ x: 2, y: 64, z: 2 }, registry.blocksByName.air.defaultState); assert.equal(world.blockAt({ x: 2, y: 64, z: 2 }).name, 'air');
  world.reset('minecraft:the_nether'); assert.equal(world.columns.size, 0); assert.equal(world.minY, 0);
});
test('inventory ignores foreign windows and uses server item IDs/counts', () => {
  const inv = new KudoInventory(registry), raw = { itemCount: 3, itemId: registry.itemsByName.birch_log.id, components: [], removeComponents: [] };
  assert.equal(inv.updateWindow({ windowId: 1, items: [] }), false);
  inv.updateSlot({ windowId: 0, stateId: 1, slot: 36, item: raw });
  assert.equal(inv.count('minecraft:birch_log'), 3); assert.equal(inv.held().name, 'birch_log'); raw.itemCount = 90;
  assert.equal(inv.count('birch_log'), 3);
});
test('mining respects hardness and tool requirements rather than sending instant completion', () => {
  const world = new KudoWorld(registry), log = world.Block.fromStateId(registry.blocksByName.birch_log.defaultState, 0), stone = world.Block.fromStateId(registry.blocksByName.stone.defaultState, 0);
  assert.ok(miningTime(registry, log, null).milliseconds >= 3000);
  assert.equal(miningTime(registry, stone, null).harvestable, false);
  const woodenPick = { type: registry.itemsByName.wooden_pickaxe.id };
  assert.equal(miningTime(registry, stone, woodenPick).harvestable, true); assert.ok(miningTime(registry, stone, woodenPick).milliseconds < 2000);
});
function fakeClient() {
  const c = new KudoConnect(), packets = [];
  c.state = { ...c.state, ...player(), status: 'ready', health: 20, food: 20, dimension: 'minecraft:overworld', gameMode: 'survival' };
  c.client = { state: 'play', write: (name, packet) => { packets.push({ name, packet }); c.emit('sent', { name, packet }); }, end() {} };
  return { c, packets };
}
test('higher priority cancels digging before dispatch, with no late finish packet', async () => {
  const { c, packets } = fakeClient(), block = { ...registry.blocksByName.oak_log, stateId: registry.blocksByName.oak_log.defaultState, shapes: [[0, 0, 0, 1, 1, 1]] };
  c.world = { blockAt: p => Math.floor(p.x) === 2 && Math.floor(p.y) === 1 && Math.floor(p.z) === 0 ? block : flat(p), stateAt: () => block.stateId };
  const started = new Promise(r => c.on('sent', ({ name, packet }) => { if (name === 'block_dig' && packet.status === 0) r(); }));
  const digging = c.execute({ skill: 'dig', args: { x: 2, y: 1, z: 0 } }); const rejected = assert.rejects(digging, /приоритет/);
  // Measure cancellation/dispatch independently of the requested smooth camera turn.
  c.skills.set('urgentTest',async()=>({ok:true}));
  await started; const before = performance.now(); await c.execute({ skill: 'urgentTest' }, { priority: 10 }); await rejected;
  assert.ok(performance.now() - before < 200); assert.equal(packets.some(p => p.name === 'block_dig' && p.packet.status === 2), false);
  assert.ok(packets.some(p => p.name === 'block_dig' && p.packet.status === 1)); assert.equal(c.pending, null); await c.close();
});
test('sending dig-finish alone cannot produce a successful mining result', async () => {
  const { c, packets } = fakeClient(), block = { ...registry.blocksByName.oak_log, hardness: 0, stateId: 131, shapes: [[0, 0, 0, 1, 1, 1]] };
  c.world = { blockAt: p => Math.floor(p.x) === 2 && Math.floor(p.y) === 1 ? block : flat(p), stateAt: () => 131 };
  const abort=new AbortController();c.on('sent',({name,packet})=>{if(name==='block_dig'&&packet.status===2)abort.abort(new Error('No server block update'));});
  await assert.rejects(c.execute({ skill: 'dig', args: { x: 2, y: 1, z: 0 } }, { signal: AbortSignal.any([abort.signal,AbortSignal.timeout(4000)]) }));
  assert.ok(packets.some(p => p.name === 'block_dig' && p.packet.status === 2)); await c.close();
});
test('short grass is traversable while fluids and portal blocks are not ordinary paths', () => {
  for (const name of ['short_grass', 'lava', 'nether_portal']) {
    const grass = { name, boundingBox: 'empty', shapes: [] }, getBlock = p => p.y === 0 ? full : p.x === 1 && p.y === 1 ? grass : p.y > 0 ? air : null;
    const route = planRoute({ start: { x: 0, y: 1, z: 0 }, goal: { x: 1, y: 1, z: 0 }, getBlock, maxNodes: 50, maxDistance: 2 });
    assert.equal(route.status, name === 'short_grass' ? 'planned' : 'blocked');
  }
});
test('runtime dependency tree and new adapter are independent of Mineflayer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.dependencies.mineflayer, undefined); assert.equal(pkg.dependencies['mineflayer-pathfinder'], undefined);
  const { c } = fakeClient(), adapter = createKudoAdapter(c); assert.equal(adapter.describe().kind, 'kudoconnect'); assert.ok(adapter.describe().skills.includes('gather'));
  await c.close();
});
