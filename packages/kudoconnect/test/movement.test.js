import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockLoader from 'prismarine-block';
import { KudoConnect } from '../src/client.js';
import { stepPhysics } from '../src/physics.js';
import { planRoute } from '../src/navigation.js';
import { SmoothLook, rotateToward, bridgeMaterials, safeCorridor, travelControl, combatControl, executeNavigate } from '../src/movement.js';

const air = { name: 'air', shapes: [], boundingBox: 'empty' }, stone = { name: 'stone', shapes: [[0, 0, 0, 1, 1, 1]], boundingBox: 'block' };
const flat = p => Math.floor(p.y) < 1 ? stone : air;
const registry = minecraftData('1.21.1'), Block = blockLoader(registry);
const initial = () => ({ position: { x: .5, y: 1, z: .5 }, velocity: { x: 0, y: -.0784, z: 0 }, yaw: -90, pitch: 0, onGround: true, food: 20, health: 20, status: 'ready' });

test('smooth look wraps the shortest way, caps angular speed, and cancels the abandoned target', () => {
  const next = rotateToward({ yaw: 179, pitch: 0 }, { yaw: -179, pitch: 70 });
  assert.ok(next.yaw > 179 || next.yaw < -179); assert.ok(next.pitch > 0 && next.pitch <= 27);
  const state = initial(), look = new SmoothLook(), abort = new AbortController();
  look.set(state, { x: 0, y: 3, z: 10 }, { signal: abort.signal });
  look.tick(state); const afterOne = { yaw: state.yaw, pitch: state.pitch };
  assert.ok(state.yaw > -90 && state.yaw < 0);
  abort.abort(); look.tick(state);
  assert.deepEqual({ yaw: state.yaw, pitch: state.pitch }, afterOne); assert.equal(look.target, null);
  look.set(state, { x: -10, y: 2.62, z: .5 });
  for (let i = 0; i < 30; i++) look.tick(state);
  assert.equal(look.target, null); assert.equal(state.yaw, 90);
});

test('waitForLook works without a physics loop and never changes the position', async () => {
  const c = new KudoConnect(), packets = [];
  Object.assign(c.state, initial()); c.client = { state: 'play', write: (name, data) => packets.push([name, data]) };
  const before = { ...c.state.position };
  c.lookAt({ x: .5, y: 2.62, z: 10 });
  assert.equal(c.state.yaw, -90);
  await c.waitForLook();
  assert.ok(Math.abs(c.state.yaw)<.001); assert.deepEqual(c.state.position, before);
  assert.ok(packets.length > 2); assert.ok(packets.every(([name]) => name === 'position_look'));
});

test('sprint physics uses vanilla acceleration and facing jump impulse; hunger and shielding disable it', () => {
  let walk = initial(), sprint = initial();
  for (let i = 0; i < 40; i++) { walk = stepPhysics(walk, { x: 1 }, flat); sprint = stepPhysics(sprint, { x: 1, sprint: true }, flat); }
  const ratio = (sprint.position.x - .5) / (walk.position.x - .5);
  assert.ok(Math.abs(ratio - 1.3) < .001);
  const jump = stepPhysics(initial(), { x: 1, sprint: true, jump: true }, flat);
  assert.ok(Math.abs(jump.position.x - .5 - (.13 * .98 + .2)) < .00001);
  assert.ok(Math.abs(jump.position.y - 1 - Math.fround(.42)) < .00001);
  assert.equal(stepPhysics({ ...initial(), food: 6 }, { x: 1, sprint: true }, flat).sprinting, false);
  assert.equal(stepPhysics(initial(), { x: 1, sprint: true, usingItem: true }, flat).sprinting, false);
});

test('sprint-jump requires a distant flat known landing corridor and enough headroom', () => {
  const state = initial(), target = { x: 20.5, y: 1, z: .5 };
  assert.equal(travelControl(state, target, flat).jump, true);
  assert.equal(travelControl(state, { ...target, x: 4 }, flat).jump, false);
  assert.equal(travelControl(state, target, p => p.y === 3 ? stone : flat(p)).jump, false);
  const unknown = p => p.x >= 3 ? null : flat(p);
  assert.equal(travelControl(state, target, unknown).jump, false);
  assert.equal(safeCorridor(state.position, { x: 1, z: 0 }, 5, unknown), false);
  assert.equal(travelControl({ ...state, food: 5 }, target, flat).sprint, false);
  assert.equal(travelControl(state, target, flat, { guarding: true }).sprint, false);
  assert.equal(travelControl({ ...state, yaw: 90 }, target, flat).sprint, false);
  const gap = p => p.y === 0 && p.x === 3 ? air : flat(p);
  assert.equal(travelControl(state, target, gap).jump, false);
});

test('material selection accepts varied ordinary blocks, preserves valuables, and supports custom valuations', () => {
  const names = ['sand', 'gravel', 'red_concrete_powder', 'diamond_block', 'raw_iron_block', 'chest', 'furnace', 'crafting_table', 'oak_slab', 'magma_block', 'cobblestone', 'dirt', 'oak_planks', 'red_concrete', 'white_wool'];
  const items = names.map((name, slot) => ({ name, slot, count: 8 }));
  const materials = bridgeMaterials(registry, items, { blockAtState: id => Block.fromStateId(id, 0) });
  assert.deepEqual(new Set(materials.map(b => b.name)), new Set(['cobblestone', 'dirt', 'oak_planks', 'red_concrete', 'white_wool']));
  assert.equal(materials[0].value, 1);
  assert.equal(bridgeMaterials(registry, items, { blockAtState: id => Block.fromStateId(id, 0), itemValue: name => name === 'white_wool' ? 0 : 10 })[0].name, 'white_wool');
  assert.equal(bridgeMaterials(registry, [{ name: 'dirt', count: 2 }], { reserve: 2 }).length, 0);
});

test('combat moves around blocked strafes but refuses unknown edges and never jumps blindly', () => {
  const state = initial(), target = { x: 10, y: 1, z: .5 };
  assert.equal(combatControl(state, target, 'approach', flat).sprint, true);
  assert.equal(combatControl(state, target, 'retreat', flat).sprint, false);
  assert.equal(combatControl(state, target, 'strafe', flat).jump, false);
  assert.deepEqual(combatControl(state, target, 'approach', () => null), { x: 0, z: 0, jump: false, sprint: false });
  const oneSide = p => p.z < 0 ? null : flat(p);
  const strafe = combatControl(state, target, 'strafe', oneSide);
  assert.ok(strafe.z > 0);
});

function simulatedClient(getBlock, items = []) {
  const c = new KudoConnect(), samples = [];
  Object.assign(c.state, initial());
  c.world = { blockAt: p => getBlock({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }), Block };
  c.inventory.items = () => items;
  c.client = { state: 'play', write() {} };
  c.timer = setInterval(() => {
    c.state = stepPhysics(c.state, c.control, c.world.blockAt); c.tickLook(); c.emit('physics');
    samples.push({ position: { ...c.state.position }, sprinting: c.state.sprinting, jumping: c.control.jump });
  }, 5);
  return { c, samples, cleanup: () => clearInterval(c.timer) };
}

test('navigation runs and jumps a long straight route, then stops within the destination cell', async () => {
  const { c, samples, cleanup } = simulatedClient(flat);
  try {
    const result = await executeNavigate(c, { x: 20, y: 1, z: 0, range: 0 }, new AbortController().signal);
    assert.equal(result.ok, true); assert.ok(Math.abs(c.state.position.x - 20.5) < .4);
    assert.ok(samples.some(s => s.sprinting)); assert.ok(samples.some(s => s.jumping));
    assert.ok(samples.every(s => s.position.y < 2.5)); assert.equal(c.control.sprint, false);
  } finally { cleanup(); }
});

test('one-block drop works near another player instead of being rejected as a flat corridor',async()=>{
  const terrain=p=>p.y<(p.x<=0?2:1)?stone:air;
  const {c,samples,cleanup}=simulatedClient(terrain);c.state.position.y=2;
  c.entities.set(8,{id:'8',kind:'player',position:{x:.5,y:2,z:2.5}});
  try{
    const result=await executeNavigate(c,{x:2,y:1,z:0,range:0,bridge:false},AbortSignal.timeout(5000));
    assert.equal(result.ok,true);assert.equal(result.estimatedFallDamage,0);assert.equal(c.state.position.y,1);
    assert.ok(samples.some(s=>s.position.y>1&&s.position.y<2));
  }finally{cleanup();}
});

test('navigation builds a mixed-material bridge only after each placement is confirmed', async () => {
  const placed = new Map(), key = p => `${p.x},${p.y},${p.z}`, calls = [];
  const terrain = p => placed.get(key(p)) || (p.z !== 0 ? stone : p.y === 0 && (p.x <= 0 || p.x >= 3) ? stone : air);
  const items = [{ name: 'cobblestone', count: 1 }, { name: 'oak_planks', count: 1 }];
  const { c, samples, cleanup } = simulatedClient(terrain, items);
  try {
    const result = await executeNavigate(c, { x: 3, y: 1, z: 0, range: 0 }, new AbortController().signal, {
      place: async p => {
        assert.ok(c.state.position.x < p.x); assert.ok(c.state.onGround);
        calls.push(p.block); const item = items.find(i => i.name === p.block.replace('minecraft:', '')); item.count--;
        placed.set(key(p), { ...stone, name: item.name });
      }
    });
    assert.equal(result.bridgeUsed, 2); assert.deepEqual(calls, ['minecraft:cobblestone', 'minecraft:oak_planks']);
    assert.ok(samples.every(s => s.position.y >= 1)); assert.ok(samples.every(s => !s.jumping));
  } finally { cleanup(); }
});

test('unknown space never becomes a bridge and missing placement confirmation stops at the edge', async () => {
  assert.equal(planRoute({ start: { x: 0, y: 1, z: 0 }, goal: { x: 3, y: 1, z: 0 }, getBlock: p => p.x > 0 ? null : flat(p), bridgeBudget: 32, maxNodes: 100 }).status, 'blocked');
  const terrain = p => p.z !== 0 ? stone : p.y === 0 && (p.x <= 0 || p.x >= 2) ? stone : air;
  const { c, cleanup } = simulatedClient(terrain, [{ name: 'dirt', count: 4 }]);
  try {
    await assert.rejects(executeNavigate(c, { x: 2, y: 1, z: 0, range: 0 }, new AbortController().signal, { place: async () => {} }), /не подтвердил/);
    assert.equal(c.state.position.x, .5); assert.equal(c.control.sprint, false);
  } finally { cleanup(); }
});
