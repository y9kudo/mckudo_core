import test from 'node:test';
import assert from 'node:assert/strict';
import {expeditionLearningEvidence, assessExpeditionRelease} from '../src/expedition-evidence.js';
import {createNeuralPlanner} from '../src/neural-planning.js';
import {createNeuralNavigator} from '../src/neural-navigation.js';

test('live learning evidence distinguishes real weight updates from time or cancelled actions', () => {
  const planner = createNeuralPlanner({worldId: 'learning-evidence'});
  const navigation = createNeuralNavigator({worldId: 'learning-evidence'});
  const baseline = expeditionLearningEvidence({planner, navigation});
  const before = {self: {position: {x: 0, y: 64, z: 0}, health: 20}, inventory: {}, dimension: 'minecraft:overworld'};
  const action = {skill: 'navigate', args: {x: 1, y: 64, z: 0}};
  planner.record({before, after: before, action, outcome: 'cancelled'});
  assert.equal(expeditionLearningEvidence({planner, navigation, baseline}).planner.weightsChanged, false);
  planner.record({before, after: before, action, outcome: 'failure'});
  navigation.record({from: before.self.position, to: action.args, dimension: before.dimension, outcome: 'failure'});
  const evidence = expeditionLearningEvidence({planner, navigation, baseline});
  assert.equal(evidence.planner.newSamples, 1);
  assert.ok(evidence.planner.newUpdates > 0);
  assert.equal(evidence.planner.weightsChanged, true);
  assert.equal(evidence.navigation.weightsChanged, true);
  assert.equal(evidence.navigation.rememberedFailures, 1);
  assert.equal(JSON.stringify(evidence).includes('"weights":'), false);
});

const scenario = {steps: [{id: 'wood', type: 'resources'}, {id: 'dragon', type: 'dragon'}]};
const victory = () => ({
  status: 'passed', full: true, originFromZero: true, goalAchieved: true,
  originInitial: {dimension: 'minecraft:overworld', gameMode: 'survival', inventory: {}, equipment: {}},
  expedition: {scenario: {completed: ['wood', 'dragon']}},
  final: {dimension: 'minecraft:the_end'}, endgame: {dragonDeath: {confirmed: true, ownDamageConfirmed: true}},
  eventsFile: 'run.events.ndjson', memoryFile: 'run.memory.json',
  externalInterventions: [], largeUnexplainedCorrections: [], deaths: []
});

test('a complete fresh-start dragon proof requests review, never publishes a release', () => {
  const result = assessExpeditionRelease(victory(), scenario);
  assert.equal(result.status, 'needs-review');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.releaseEligible, false);
});

test('release evidence rejects assisted, partial, unevidenced and non-survival campaigns', () => {
  for (const [check, change] of [
    ['emptySurvivalStart', r => r.originInitial.inventory = {'minecraft:diamond': 64}],
    ['emptySurvivalStart', r => r.originInitial.gameMode = 'creative'],
    ['emptySurvivalStart', r => {delete r.originInitial; r.resumed = true;}],
    ['ownDragonVictory', r => r.endgame.dragonDeath.ownDamageConfirmed = false],
    ['allStagesObserved', r => r.expedition.scenario.completed = ['dragon']],
    ['noRecordedAssistance', r => r.externalInterventions.push({type: 'give'})],
    ['noUnexplainedTeleport', r => r.largeUnexplainedCorrections.push({distance: 99})],
    ['durableEvidence', r => r.journalError = 'disk full']
  ]) {
    const report = victory(); change(report);
    assert.ok(assessExpeditionRelease(report, scenario).blockers.includes(check), check);
  }
});
