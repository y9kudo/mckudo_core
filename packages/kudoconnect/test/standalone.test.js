import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import minecraftData from 'minecraft-data';
import { KudoConnect, KudoWorld, KudoPeer, createFleet, stepPhysics, environmentAt, solveAim, traceProjectile, projectileProfile } from '../index.js';
const air = { name: 'air', shapes: [], boundingBox: 'empty' }, stone = { name: 'stone', shapes: [[0,0,0,1,1,1]], boundingBox: 'block' };
const flat = p => p.y < 1 ? stone : air;
const state = (y = 1) => ({ position: { x: .5, y, z: .5 }, velocity: { x: 0, y: 0, z: 0 }, onGround: y === 1, health: 20 });
test('the standalone package source has no imports of MCKudo or Mineflayer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.name, 'kudoconnect'); assert.equal(pkg.dependencies.mckudo, undefined); assert.equal(pkg.dependencies.mineflayer, undefined);
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:\.\.\/|mckudo|mineflayer)/, file);
  }
});
test('fleet creates exactly 1–10 unique English clients and cleans every connection after a failure', async () => {
  assert.throws(() => createFleet({ count: 11 })); assert.throws(() => createFleet({ count: 2, names: ['Alice', 'alice'] }));
  const calls = [], fleet = createFleet({ count: 10, createClient: o => ({ async connect() { calls.push(o.username); }, async close() { calls.push('closed:' + o.username); }, snapshot() { return { name: o.username }; } }) });
  await fleet.connect(); assert.equal(calls.length, 10); assert.equal(fleet.agents.size, 10); await fleet.close(); assert.equal(calls.length, 20);
  let closed = 0;
  const failed = createFleet({ count: 3, names:['Alice','Blake','Charlie'], createClient: o => ({ async connect() { if (o.username === 'Blake') throw new Error('offline'); }, async close() { closed++; } }) });
  await assert.rejects(failed.connect(), /offline/); assert.equal(closed, 3);
});
test('peers settle simultaneous claims identically despite reordering, replay and expiration', () => {
  let now = 1000; const messages = [], peers = ['Alice','Blake'].map(id => new KudoPeer({ id, team: 'test', peers: ['Alice','Blake'], clock: () => now, send: e => messages.push(e) }));
  const a = peers[0].claim('tree/1'), b = peers[1].claim('tree/1');
  peers[0].receive(b); peers[1].receive(a); assert.equal(peers[0].owner('tree/1'), null);
  now += 101; assert.equal(peers[0].owner('tree/1'), 'Alice'); assert.equal(peers[1].owner('tree/1'), 'Alice');
  const release = peers[0].release('tree/1'); peers[1].receive(release); assert.equal(peers[1].owner('tree/1'), 'Blake');
  assert.equal(peers[1].receive(a), false); assert.equal(peers[1].receive({ ...a, team: 'other' }), false);
  now += 31000; assert.equal(peers[1].owner('tree/1'), null); assert.equal(peers[1].receive(b), false);
  peers.forEach(p => p.close());
});
test('fleet routes private JSON outside Minecraft and isolates caller mutations', async () => {
  let packets = 0; const f = createFleet({ count: 3, names:['Alice','Blake','Charlie'], createClient: () => ({ async connect() {}, async close() {}, write() { packets++; } }) });
  const received = []; for (const [name, p] of f.peers) p.on('message', e => received.push([name, e]));
  const payload = { blocks: ['birch_log'] }; f.peers.get('Alice').send('discovery', payload, { to: 'Blake' }); payload.blocks.push('fake');
  assert.deepEqual(received.map(r => r[0]), ['Blake']); assert.deepEqual(received[0][1].payload.blocks, ['birch_log']); assert.equal(packets, 0); await f.close();
});
test('fluid surface height excludes a player above shallow water; unknown chunks freeze', () => {
  const shallow = { ...air, name: 'water', getProperties: () => ({ level: 7 }) };
  assert.equal(environmentAt({ x: .5, y: .5, z: .5 }, p => p.y === 0 ? shallow : air).medium, 'air');
  assert.equal(environmentAt({ x: .5, y: .05, z: .5 }, p => p.y === 0 ? shallow : air).medium, 'water');
  assert.equal(stepPhysics(state(), { x: 1 }, () => null).frozen, true);
});
test('water swimming and lava drag differ; lava danger does not fabricate server health', () => {
  const liquid = n => () => ({ ...air, name: n, getProperties: () => ({ level: 0 }) });
  let w = state(3), l = state(3);
  for (let i = 0; i < 10; i++) { w = stepPhysics(w, { x: 1, jump: true }, liquid('water')); l = stepPhysics(l, { x: 1, jump: true }, liquid('lava')); }
  assert.ok(w.position.y > 3); assert.ok(w.position.x > l.position.x); assert.equal(l.environment.hazardous, true); assert.equal(l.health, 20);
});
test('slime bounces unless sneaking; honey reduces jump; web arrests momentum; ice retains inertia', () => {
  const surface = n => p => p.y < 1 ? { ...stone, name: n } : air;
  const falling = { ...state(1.2), velocity: { x: 0, y: -.5, z: 0 } };
  assert.ok(stepPhysics(falling, {}, surface('slime_block')).velocity.y > 0);
  assert.ok(stepPhysics(falling, { sneak: true }, surface('slime_block')).velocity.y < 0);
  assert.ok(stepPhysics(state(), { jump: true }, surface('honey_block')).position.y < stepPhysics(state(), { jump: true }, flat).position.y);
  const fast = { ...state(3), velocity: { x: 1, y: -.5, z: 0 } }, web = stepPhysics(fast, {}, () => ({ ...air, name: 'cobweb' }));
  assert.ok(web.position.x < 1); assert.equal(web.velocity.x, 0); assert.ok(web.position.y > 2.9);
  const slide = { ...state(), velocity: { x: .5, y: -.08, z: 0 } };
  assert.ok(stepPhysics(slide, {}, surface('ice')).velocity.x > stepPhysics(slide, {}, flat).velocity.x);
});
test('ballistics leads a moving target; independent integration reaches the predicted point', () => {
  const input = { origin: { x: 0, y: 2, z: 0 }, target: { x: 24, y: 2, z: 0 }, targetVelocity: { x: 0, y: 0, z: .12 }, getBlock: () => air };
  for (const weapon of ['bow', 'crossbow', 'trident']) {
    const shot = solveAim({ ...input, weapon }); assert.equal(shot.status, 'aimed'); assert.ok(shot.predicted.z > .5); assert.equal(shot.hitConfirmed, false);
    let p = { ...input.origin }, v = { ...shot.velocity }, t = 0;
    const profile = projectileProfile(weapon);
    while (t < shot.ticks) { const dt = Math.min(1, shot.ticks - t); for (const k of ['x','y','z']) { p[k] += v[k] * dt; v[k] *= .99; } v.y -= profile.gravity; t += dt; }
    assert.ok(Math.hypot(p.x - shot.predicted.x, p.y - shot.predicted.y, p.z - shot.predicted.z) < .01);
  }
});
test('projectiles reject unknown paths, thin obstacles and impossible interception', () => {
  const origin = { x: .5, y: 2, z: .5 }, target = { x: 20, y: 2, z: .5 };
  assert.equal(solveAim({ origin, target, getBlock: () => null }).status, 'blocked');
  const thin = p => p.x === 1 ? { ...stone, shapes: [[.49,0,0,.5,1,1]] } : air;
  assert.equal(traceProjectile({ origin, velocity: { x: 3, y: 0, z: 0 }, ticks: 1, getBlock: thin }).status, 'blocked');
  assert.equal(solveAim({ origin, target: { x: 10000, y: 2, z: 0 }, getBlock: () => air }).status, 'blocked');
});
test('world searches #logs and filters actual block state properties without a core catalog', async () => {
  const registry = minecraftData('1.21.1'), world = new KudoWorld(registry), column = new world.Chunk({ minY: -64, worldHeight: 384 });
  column.setBlockStateId({ x: 1, y: 64, z: 1 }, registry.blocksByName.birch_log.defaultState);
  column.setBlockStateId({ x: 10, y: 64, z: 1 }, registry.blocksByName.oak_log.defaultState); world.load({ x: 0, z: 0, chunkData: column.dump() });
  const result = await world.findBlocks({ classes: ['#logs'], position: { x: .5, y: 64, z: 1.5 }, properties: { axis: 'y' } });
  assert.equal(result.blocks[0].name, 'minecraft:birch_log'); assert.equal(result.blocks[0].properties.axis, 'y');
  await assert.rejects(world.findBlocks({ classes: ['#invented'], position: { x: 0, y: 64, z: 0 } }));
});
test('custom skills use the same cancellation lock and bounded action trace', async () => {
  const c = new KudoConnect(); c.state.status = 'ready'; c.client = { state: 'play', end() {}, write() {} };
  c.registerSkill('inspect', () => ({ observed: true }));
  assert.deepEqual(await c.execute({ skill: 'inspect' }), { observed: true }); assert.equal(c.trace[0].outcome, 'success');
  assert.throws(() => c.registerSkill('dig', () => {})); await c.close();
});
function armed(weapon, charged = false) {
  const c = new KudoConnect(), packets = [];
  c.state = { ...c.state, ...state(), status: 'ready', health: 20, food: 20 };
  c.world = { blockAt: flat };
  const slot = (name, count, components = []) => ({ itemCount: count, itemId: c.registry.itemsByName[name].id, addedComponentCount: components.length, removedComponentCount: 0, components, removeComponents: [] });
  const components = charged ? [{ type: 'charged_projectiles', data: { projectiles: [slot('arrow', 1)] } }] : [];
  c.inventory.updateSlot({ windowId: 0, slot: 36, stateId: 1, item: slot(weapon, 1, components) });
  c.inventory.updateSlot({ windowId: 0, slot: 37, stateId: 2, item: slot('arrow', 3) });
  c.entities.set(42, { id: '42', name: 'zombie', kind: 'entity', position: { x: 20, y: 1, z: .5 }, velocity: { x: 0, y: 0, z: 0 }, metadata: {} });
  c.client = { state: 'play', end() {}, write(name, packet) { packets.push({ name, packet }); c.emit('sent', { name, packet }); } };
  return { c, packets, slot };
}
test('cancelling a drawn bow switches slots and never releases an arrow at the abandoned target', async () => {
  const { c, packets } = armed('bow');
  const started = new Promise(resolve => c.on('sent', e => { if (e.name === 'use_item') resolve(); }));
  const shot = c.execute({ skill: 'shoot', args: { entityId: '42' } }); const rejected = assert.rejects(shot, /приоритет/);
  await started; await c.execute({ skill: 'look', args: { x: 1, y: 2, z: 0 } }, { priority: 100 }); await rejected;
  assert.equal(packets.some(e => e.name === 'block_dig' && e.packet.status === 5), false);
  assert.ok(packets.some(e => e.name === 'held_item_slot' && e.packet.slotId === 1)); assert.equal(c.trace[0].outcome, 'cancelled'); await c.close();
});
test('loaded crossbow fires once and distinguishes ammunition confirmation from target damage', async () => {
  const { c, packets, slot } = armed('crossbow', true);
  c.on('sent', e => { if (e.name === 'use_item') c.inventory.updateSlot({ windowId: 0, slot: 36, stateId: 3, item: slot('crossbow', 1) }); });
  const result = await c.execute({ skill: 'shoot', args: { entityId: '42', weapon: 'crossbow' } });
  assert.equal(result.shotServerConfirmed, true); assert.equal(result.hitConfirmed, false); assert.equal(packets.filter(e => e.name === 'use_item').length, 1); await c.close();
});
test('ranged PvP needs permission and unknown terrain prevents charging', async () => {
  const { c, packets } = armed('bow'); c.entities.get(42).kind = 'player';
  await assert.rejects(c.execute({ skill: 'shoot', args: { entityId: '42' } }), /PvP/);
  c.entities.get(42).kind = 'entity'; c.world.blockAt = () => null;
  await assert.rejects(c.execute({ skill: 'shoot', args: { entityId: '42' } }), /траектории/);
  assert.equal(packets.some(e => e.name === 'use_item'), false); await c.close();
});
