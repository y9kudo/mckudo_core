import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { combatDecision, chooseWeapon, createCombatReactor } from '../mckudo_core.js';
import { createCombatExecutor } from '../adapters/mineflayer-combat.js';
import { createDropCollector } from '../adapters/mineflayer-drops.js';
const self = { health: 20, shield: true, position: { x: 0, y: 64, z: 0 } };
const target = { id: '2', name: 'zombie', position: { x: 2, y: 64, z: 0 } };
const signal = () => new AbortController().signal;
const goals = { GoalNear: class { constructor(x, y, z, range) { Object.assign(this, { x, y, z, range }); } } };
const check = s => s.throwIfAborted();
test('combat guards during cooldown, strikes only when ready, and retreats from immediate danger', () => {
  assert.equal(combatDecision({ self, target, nextAttackAt: 625, now: 100 }).mode, 'block');
  assert.equal(combatDecision({ self, target, nextAttackAt: 625, now: 625 }).mode, 'strike');
  assert.equal(combatDecision({ self: { ...self, shield: false }, target, nextAttackAt: 625, now: 100 }).mode, 'strafe');
  assert.equal(combatDecision({ self: { ...self, health: 6 }, target }).mode, 'retreat');
  assert.equal(combatDecision({ self, target: { ...target, name: 'creeper' } }).mode, 'retreat');
});
test('ranged enemies do not cause permanent blocking; incoming projectiles do', () => {
  const skeleton = { ...target, ranged: true, position: { x: 10, y: 64, z: 0 } };
  assert.equal(combatDecision({ self, target: skeleton }).mode, 'approach');
  const arrow = { position: { x: 10, y: 65, z: 0 }, velocity: { x: -1, y: 0, z: 0 } };
  assert.equal(combatDecision({ self, target: skeleton, projectiles: [arrow] }).mode, 'block');
  assert.equal(combatDecision({ self, target: skeleton, projectiles: [{ ...arrow, velocity: { x: 1, y: 0, z: 0 } }] }).mode, 'approach');
});
test('weapon choice considers damage recovery and switches to an axe against a shield', () => {
  const items = [{ name: 'iron_axe' }, { name: 'diamond_sword' }];
  assert.equal(chooseWeapon(items).name, 'diamond_sword');
  assert.equal(chooseWeapon(items, { shieldedTarget: true }).name, 'iron_axe');
});
test('tactical reactor respects player retaliation policy', () => {
  const observation = { self, entities: [{ ...target, kind: 'player', username: 'Guest' }], combat: { attackers: [{ entityId: '2', hits: 2, lastHitAt: 100 }] } };
  assert.equal(createCombatReactor({ clock: () => 101 }).react(observation).action, null);
  assert.equal(createCombatReactor({ attackPlayers: true, clock: () => 101 }).react(observation).action.skill, 'combat');
  assert.equal(createCombatReactor({ attackPlayers: true, trustedPlayers: ['Guest'], clock: () => 101 }).react(observation).action, null);
});
test('combat executor immediately selects a hotbar sword, equips offhand, and cleans controls on cancellation', async () => {
  const bot = new EventEmitter(), sword = { name: 'iron_sword', type: 1, slot: 38 }, guard = { name: 'shield', type: 2, slot: 10 }, calls = [];
  bot.entity = { position: new Vec3(0, 64, 0) }; bot.health = 20; bot.heldItem = { name: 'iron_pickaxe' };
  bot.entities = { 2: { ...target, position: new Vec3(2, 64, 0), isValid: true } };
  bot.inventory = { items: () => [sword, guard], slots: [] };
  bot.pathfinder = { setGoal: g => calls.push(['goal', g]) };
  bot.clearControlStates = () => calls.push(['clear']); bot.lookAt = async () => {};
  bot.setQuickBarSlot = n => { calls.push(['slot', n]); bot.heldItem = sword; };
  bot.equip = async (item, slot) => { calls.push(['equip', slot]); bot.inventory.slots[45] = item; };
  bot.activateItem = off => calls.push(['guard', off]); bot.deactivateItem = () => calls.push(['release']);
  const ac = new AbortController(), executor = createCombatExecutor(bot, { goals, check });
  const task = executor.execute({ entityId: '2', durationMs: 1000 }, ac.signal);
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(calls.find(c => c[0] === 'slot'), ['slot', 2]);
  assert.ok(calls.some(c => c[0] === 'equip' && c[1] === 'off-hand'));
  assert.ok(calls.some(c => c[0] === 'guard' && c[1] === true));
  assert.equal(executor.state().shieldUp, false);
  assert.deepEqual(calls.at(-1), ['release']);
});
function collectorBot() {
  const bot = new EventEmitter(), goalsIssued = []; let inventory = [];
  bot.entity = { id: 1, position: new Vec3(0, 64, 0) }; bot.entities = {};
  bot.inventory = { items: () => inventory }; bot.pathfinder = { setGoal: g => goalsIssued.push(g) }; bot.clearControlStates = () => {};
  const drop = { id: 2, name: 'item', position: new Vec3(3, 66, 0), getDroppedItem: () => ({ name: 'oak_log', count: 1 }) }; bot.entities[2] = drop;
  return { bot, drop, goalsIssued, setInventory: value => { inventory = value; } };
}
test('collector follows a falling item and does not repeatedly reset a stationary path', async () => {
  const f = collectorBot(), collector = createDropCollector(f.bot, { goals, check });
  const task = collector.collect({ item: 'minecraft:oak_log', timeoutMs: 2000 }, signal());
  setTimeout(() => { f.drop.position = new Vec3(3, 64, 0); }, 100);
  setTimeout(() => { f.setInventory([{ name: 'oak_log', count: 1 }]); }, 900);
  const result = await task;
  assert.equal(result.gained, 1);
  assert.equal(f.goalsIssued.filter(Boolean).length, 2);
  assert.deepEqual(f.goalsIssued.filter(Boolean).map(g => g.y), [66, 64]);
  assert.equal(f.bot.listenerCount('playerCollect'), 0);
});
test('another player collecting an item or an entity unloading cannot count as our pickup', async () => {
  const f = collectorBot(), collector = createDropCollector(f.bot, { goals, check });
  const task = collector.collect({ item: 'minecraft:oak_log', timeoutMs: 200 }, signal());
  f.bot.emit('playerCollect', { id: 90 }, f.drop); delete f.bot.entities[2];
  await assert.rejects(task, /не подтверждён/); assert.equal(f.bot.listenerCount('playerCollect'), 0);
});
test('drop merging does not pin collection to a vanished entity ID', async () => {
  const f = collectorBot(), collector = createDropCollector(f.bot, { goals, check });
  const task = collector.collect({ item: 'minecraft:oak_log', timeoutMs: 1500 }, signal());
  setTimeout(() => { delete f.bot.entities[2]; f.bot.entities[3] = { ...f.drop, id: 3, position: new Vec3(4, 64, 0) }; }, 100);
  setTimeout(() => { f.setInventory([{ name: 'oak_log', count: 2 }]); }, 600);
  assert.equal((await task).gained, 2); assert.ok(f.goalsIssued.some(g => g?.x === 4));
});
