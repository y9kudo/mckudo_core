import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { createNetherPortalBlueprint, planNetherPortal, billOfMaterials, blockKey, triangulateEyes, aimBow, dragonDecision, fortressEvidence, validateScenario, createScenario } from '../mckudo_core.js';
import { createEndgameExecutor } from '../adapters/mineflayer-endgame.js';
import { sampleCatalog } from '../examples/sample-catalog.js';
const p = (x, z, y = 64) => ({ x, y, z });
test('portal blueprint supports both axes and requires a full confirmed frame before ignition', () => {
  for (const axis of ['x', 'z']) {
    const b = createNetherPortalBlueprint({ origin: p(0, 0), axis });
    assert.equal(billOfMaterials(b)['minecraft:obsidian'], 14); assert.equal(b.air.length, 6);
    const blocks = Object.fromEntries([...b.cells, ...b.air].map(c => [blockKey(c), 'minecraft:air']));
    assert.equal(planNetherPortal({ blueprint: b, blocks }).status, 'needs-materials');
    for (const c of b.cells) blocks[blockKey(c)] = c.block;
    assert.equal(planNetherPortal({ blueprint: b, blocks, inventory: { 'minecraft:flint_and_steel': 1 } }).actions[0].skill, 'ignitePortal');
    delete blocks[blockKey(b.cells[0])]; assert.equal(planNetherPortal({ blueprint: b, blocks }).status, 'blocked');
    blocks[blockKey(b.cells[0])] = 'minecraft:obsidian'; for (const c of b.air) blocks[blockKey(c)] = 'minecraft:nether_portal';
    assert.equal(planNetherPortal({ blueprint: b, blocks }).status, 'completed');
  }
});
const ray = (origin, end) => ({ dimension: 'minecraft:overworld', origin, end });
test('eyes triangulate intersecting forward rays without using world data', () => {
  const result = triangulateEyes([ray(p(0, 0), p(10, 10)), ray(p(100, 0), p(100, 10))]);
  assert.equal(result.status, 'estimated'); assert.ok(Math.abs(result.position.x - 100) < 0.001); assert.ok(Math.abs(result.position.z - 100) < 0.001);
});
test('eyes reject parallel, short, backward and wrong-dimension evidence', () => {
  assert.equal(triangulateEyes([ray(p(0, 0), p(10, 0)), ray(p(0, 20), p(10, 20))]).status, 'insufficient');
  assert.equal(triangulateEyes([ray(p(0, 0), p(0.5, 0)), ray(p(100, 0), p(100, 10))]).status, 'insufficient');
  assert.equal(triangulateEyes([ray(p(0, 0), p(-10, -10)), ray(p(100, 0), p(100, 10))]).status, 'inconsistent');
  assert.throws(() => triangulateEyes([{ ...ray(p(0, 0), p(10, 10)), dimension: 'minecraft:the_nether' }, ray(p(100, 0), p(100, 10))]), /overworld/);
});
test('bow model reaches a high crystal and reports impossible shots', () => {
  const aim = aimBow({ origin: p(0, 0), target: p(30, 0, 85) });
  assert.equal(aim.status, 'aimed'); assert.ok(aim.pitch > 0); assert.ok(aim.error < 0.5); assert.ok(aim.ticks > 10);
  assert.equal(aimBow({ origin: p(0, 0), target: p(1000, 0) }).status, 'blocked');
});
test('dragon tactics prioritize breath and crystals, never infer victory from missing entities', () => {
  const o = { dimension: 'minecraft:the_end', self: { health: 20, position: p(0, 0) }, entities: [{ id: '1', name: 'ender_dragon', position: p(40, 0), phase: 0 }, { id: '2', name: 'end_crystal', position: p(20, 0) }] };
  assert.equal(dragonDecision(o).mode, 'crystal');
  o.entities.push({ id: '3', name: 'area_effect_cloud', position: p(1, 0), radius: 3 }); assert.equal(dragonDecision(o).mode, 'evade');
  o.entities = []; assert.equal(dragonDecision(o).mode, 'search');
  o.endgame = { dragonDeath: { confirmed: true } }; assert.equal(dragonDecision(o).mode, 'completed');
});
test('Nether brick evidence is a search candidate, not proof that a structure is a fortress', () => {
  const o = { dimension: 'minecraft:the_nether', world: { sampledBlocks: [{ name: 'minecraft:nether_bricks', position: p(0, 0) }] } };
  assert.equal(fortressEvidence(o).candidate, true); assert.equal(fortressEvidence({ ...o, dimension: 'minecraft:overworld' }).candidate, false);
});
test('endgame ledger requires correlated explosion plus disappearance and a real dragon death event', () => {
  const bot = new EventEmitter(); bot._client = new EventEmitter(); bot.game = { dimension: 'the_end' }; bot.entities = {}; bot.entity = { id: 1 };
  const executor = createEndgameExecutor(bot, { goals: {}, check: () => {} });
  const crystal = { id: 2, name: 'end_crystal', position: new Vec3(10, 80, 0) }, dragon = { id: 3, name: 'ender_dragon' };
  bot.emit('entitySpawn', crystal); bot.emit('entityGone', crystal); bot.emit('entityGone', dragon);
  assert.equal(executor.observe().crystals[0].destroyed, undefined); assert.equal(executor.observe().dragonDeath, null);
  bot._client.emit('explosion', { x: 10, y: 80, z: 0 }); assert.equal(executor.observe().crystals[0].destroyed, true);
  bot.emit('entityHurt', dragon, bot.entity); bot.emit('entityDead', dragon);
  assert.equal(executor.observe().dragonDeath.ownDamageConfirmed, true); assert.equal(executor.observe().allInitialCrystalsConfirmed, false);
  executor.dispose(); assert.equal(bot.listenerCount('entityDead'), 0); assert.equal(bot._client.listenerCount('explosion'), 0);
});
test('scenario validation catches typos before connecting and isolates caller data', () => {
  const input = { schemaVersion: 1, name: 'Example', steps: [{ id: 'wood', type: 'resources', targets: { '#logs': 2 } }] };
  const copy = validateScenario(input); input.steps[0].targets['#logs'] = 100; assert.equal(copy.steps[0].targets['#logs'], 2);
  assert.throws(() => validateScenario({ ...copy, steps: [{ id: 'x', type: 'eyes', cout: 12 }] }), /неизвестное поле/);
  assert.throws(() => validateScenario({ ...copy, steps: [copy.steps[0], copy.steps[0]] }), /уникальные/);
});
test('scenario advances only from observed resources and completed dragon death, not action requests', () => {
  const controller = createScenario({ catalog: sampleCatalog(), scenario: { schemaVersion: 1, name: 'Test', steps: [{ id: 'wood', type: 'collect', item: 'minecraft:oak_log', count: 1 }, { id: 'dragon', type: 'dragon' }] } });
  const o = { dimension: 'minecraft:the_end', self: { health: 20, position: p(0, 0) }, inventory: {}, entities: [], drops: [{ item: 'minecraft:oak_log', position: p(2, 0) }] };
  assert.equal(controller.reactor.react(o).action.skill, 'collect'); assert.deepEqual(controller.snapshot().completed, []);
  o.inventory['minecraft:oak_log'] = 1; controller.reactor.react(o); assert.equal(controller.snapshot().current, 'dragon'); assert.equal(controller.snapshot().status, 'blocked');
  o.endgame = { dragonDeath: { confirmed: true } }; controller.reactor.react(o); assert.equal(controller.snapshot().status, 'completed');
});
