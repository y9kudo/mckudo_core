import test from 'node:test';
import assert from 'node:assert/strict';
import { KudoConnect, gazeError } from '../index.js';
const air = { name: 'air', shapes: [] };
function setup() {
  const c = new KudoConnect({ username: 'Alice' });
  c.state = { ...c.state, status: 'ready', entityId: 1, position: { x: 0, y: 64, z: 0 }, yaw: 0, pitch: 0, health: 20 };
  c.world.blockAt = () => air;
  c.players.update({ action: { add_player: true, update_listed: true }, data: [{ uuid: 'bob-uuid', player: { name: 'Blake' }, listed: 1 }] });
  const e = { id: '2', uuid: 'bob-uuid', kind: 'player', name: 'player', position: { x: 4, y: 64, z: 0 }, yaw: 90, headYaw: 90, pitch: 0, velocity: { x: 0, y: 0, z: 0 }, metadata: {} };
  c.entities.set(2, e); c.players.enrich(e); return { c, e };
}
test('player identity reconciles both packet orders and never invents tab-list positions', () => {
  const { c, e } = setup(); assert.equal(c.players.entity('bLaKe'), e);
  c.entities.clear(); assert.equal(c.players.snapshot()[0].position, null); assert.equal(c.players.snapshot()[0].observed, false);
  c.players.directory.clear(); c.entities.set(2, e); c.players.enrich(e); assert.equal(c.players.entity('Blake'), null);
  c.players.update({ action: { add_player: true }, data: [{ uuid: 'bob-uuid', player: { name: 'Blake' } }] }); assert.equal(c.players.entity('Blake'), e);
  c.players.remove({ players: ['bob-uuid'] }); assert.equal(c.players.entity('Blake'), null);
});
test('attention follows a moving player, records eye-height and yields to combat', () => {
  const { c, e } = setup(); const lease = c.watchPlayer('Blake');
  c.lookAt({x:-10,y:65,z:0}); // stale navigation gaze must not fight social attention
  c.attention.tick(); c.tickLook(); assert.equal(c.look.target,null);
  for (let i = 0; i < 10; i++) c.attention.tick(); assert.ok(gazeError(c.state, e) < 1); assert.equal(c.attention.last.status, 'tracking');
  e.position.z = 4; e.eyeHeight = 1.27; for (let i = 0; i < 10; i++) c.attention.tick(); assert.ok(gazeError(c.state, e) < 1);
  c.pending = { skill: 'combat', priority: 990 }; const yaw = c.state.yaw; e.position.z = -4; c.attention.tick(); assert.equal(c.state.yaw, yaw); assert.equal(c.attention.last.status, 'yielded');
  c.pending = null; lease.stop(); c.attention.tick(); assert.equal(c.attention.last.status, 'idle');
});
test('attention stops at unknown terrain and lost entities; UUID prevents name replacement', () => {
  const { c, e } = setup(); c.watchPlayer('Blake'); c.attention.tick();
  c.world.blockAt = () => null; c.attention.tick(); assert.equal(c.attention.last.status, 'occluded');
  c.world.blockAt = () => air; c.entities.clear();
  const other = { ...e, uuid: 'impostor' }; c.entities.set(3, other); c.attention.tick(); assert.equal(c.attention.last.status, 'lost');
  assert.equal(c.attention.leases.size, 1);
});
test('gaze comparison uses received head rotation and shortest angular wrap', () => {
  const target = { position: { x: 0, y: 64, z: -5 } };
  assert.ok(gazeError({ position: { x: 0, y: 64, z: 0 }, yaw: 0, headYaw: 179, pitch: 0 }, target) < 2);
  assert.equal(gazeError({ position: { x: 0, y: 64, z: 0 } }, target), null);
});
