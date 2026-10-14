import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperienceModel, createCore, createAdaptiveScenario } from '../overmindmc.js';
const action = { skill: 'gather', args: { block: '#logs' } };
const observation = n => ({ dimension: 'minecraft:overworld', inventory: { wood: n }, world: { reachable: true } });
const model = options => createExperienceModel({ worldId: 'lab', facts: ['/inventory/wood'], contextFacts: ['/dimension', '/world/reachable'], ...options });
function train(m, n = 3) { for (let i = 0; i < n; i++) m.record({ episodeId: 'episode-' + i, action, before: observation(i), after: observation(i + 1), outcome: 'success' }); }
test('operators are inferred without recipes; duplicates, unknown data and cancellation do not count', () => {
  const m = model(); train(m, 2); assert.equal(m.operators().length, 0);
  m.record({ episodeId: 'episode-1', action, before: observation(0), after: observation(1), outcome: 'success' }); assert.equal(m.operators().length, 0);
  m.record({ episodeId: 'cancel', action, before: observation(0), after: observation(1), outcome: 'cancelled' });
  m.record({ episodeId: 'unknown', action, before: observation(0), after: { ...observation(0), inventory: {} }, outcome: 'success' }); assert.equal(m.operators().length, 0);
  m.record({ episodeId: 'third', action, before: observation(2), after: observation(3), outcome: 'success' });
  assert.deepEqual(m.operators()[0].effects, [{ fact: '/inventory/wood', add: 1 }]);
  assert.ok(m.snapshot().hypotheses[0].confidence < 1);
});
test('failure retracts a learned rule immediately; repeated changed effects rebuild it', () => {
  let now = 1000; const m = model({ clock: () => now }); train(m);
  m.record({ episodeId: 'failure', action, before: observation(0), after: observation(0), outcome: 'failure' });
  assert.equal(m.operators().length, 0); assert.equal(m.assess(action, observation(0)).blocked, true);
  now += 10000;
  for (let i = 0; i < 4; i++) m.record({ episodeId: 'changed-' + i, action, before: observation(i), after: observation(i + 2), outcome: 'success' });
  assert.equal(m.operators()[0].effects[0].add, 2); assert.equal(m.snapshot().journal.some(e => e.status === 'retracted'), true);
});
test('real core observations train a model that can drive the symbolic planner', async () => {
  const m = model(); let n = 0;
  const adapter = { describe: () => ({ protocolVersion: 1, skills: ['gather'] }), observe: async () => observation(n), execute: async () => { n++; return { ok: true }; } };
  const trainer = createCore({ config: { schemaVersion: 4, name: 'Alice', worldId: 'lab', rules: [{ id: 'explore', action }] }, adapter, learning: m });
  for (let i = 0; i < 3; i++) await trainer.tick(); assert.equal(m.operators().length, 1);
  const learner = createCore({ config: { schemaVersion: 4, name: 'Blake', worldId: 'lab', goals: [{ id: 'wood', desired: { fact: '/inventory/wood', gte: 5 } }] }, adapter, planning: { experience: m, minIntervalMs: 0 } });
  await learner.tick(); const final = await learner.tick(); assert.equal(n, 5); assert.equal(final.brain.goals[0].status, 'achieved');
  await trainer.stop(); await learner.stop();
});
test('adaptive scenario changes strategy after failure and preserves the declared goal', () => {
  const m = model(), backup = { skill: 'collect', args: { item: 'wood' } };
  const adaptive = createAdaptiveScenario({ model: m, desired: { fact: '/inventory/wood', gte: 1 }, strategies: [{ id: 'tree', when: { fact: '/world/reachable', eq: true }, action }, { id: 'drop', action: backup }] });
  assert.equal(adaptive.reactor.react(observation(0)).action.skill, 'gather');
  m.record({ episodeId: 'blocked-tree', action, before: observation(0), outcome: 'failure' });
  assert.equal(adaptive.reactor.react(observation(0)).action.skill, 'collect'); assert.equal(adaptive.snapshot().revision, 2);
  assert.equal(adaptive.reactor.react(observation(1)).action, null); assert.equal(adaptive.snapshot().status, 'completed');
});
