import {createHash} from 'node:crypto';

const digest = weights => weights ? createHash('sha256').update(JSON.stringify(weights)).digest('hex') : null;

/** Summarize actual online updates without embedding weights in every report. */
export function expeditionLearningEvidence({planner, navigation, baseline} = {}) {
  const summarize = (model, previous) => {
    if (!model) return null;
    const state = model.snapshot(), memory = model.export(), weightsSha256 = digest(memory.weights);
    return {
      kind: state.kind, architecture: state.architecture,
      samples: state.samples, updates: state.updates, loss: state.loss,
      newSamples: Math.max(0, state.samples - (previous?.samples ?? state.samples)),
      newUpdates: Math.max(0, state.updates - (previous?.updates ?? state.updates)),
      weightsSha256, weightsChanged: Boolean(previous?.weightsSha256 && previous.weightsSha256 !== weightsSha256),
      rememberedFailures: state.rememberedFailures ?? null,
      recentExperience: structuredClone(state.journal ?? [])
    };
  };
  return {
    method: 'Online backpropagation with bounded replay; symbolic recipes and hard safety constraints',
    scope: 'Learning action failure risk and navigation costs; these updates do not prove mastery of Minecraft',
    planner: summarize(planner, baseline?.planner),
    navigation: summarize(navigation, baseline?.navigation)
  };
}

/** A live victory is a prerequisite for review, never an automatic release. */
export function assessExpeditionRelease(report, scenario) {
  if (!report || !Array.isArray(scenario?.steps) || !scenario.steps.length) throw new Error('A report and nonempty expedition scenario are required.');
  const completed = new Set(report.expedition?.scenario?.completed ?? []);
  const origin = report.originInitial ?? (report.resumed ? null : report.initial);
  const dragon = report.endgame?.dragonDeath;
  const checks = {
    fullCampaign: report.full === true && scenario.steps.at(-1).type === 'dragon',
    emptySurvivalStart: report.originFromZero === true && origin?.dimension === 'minecraft:overworld' &&
      [0, 'survival'].includes(origin?.gameMode) && Object.keys(origin.inventory ?? {}).length === 0 &&
      Object.values(origin.equipment ?? {}).every(item => !item),
    allStagesObserved: scenario.steps.every(step => completed.has(step.id)),
    ownDragonVictory: report.goalAchieved === true && report.final?.dimension === 'minecraft:the_end' &&
      dragon?.confirmed === true && dragon?.ownDamageConfirmed === true,
    noRecordedAssistance: Array.isArray(report.externalInterventions) && report.externalInterventions.length === 0,
    noUnexplainedTeleport: Array.isArray(report.largeUnexplainedCorrections) && report.largeUnexplainedCorrections.length === 0,
    durableEvidence: !report.journalError && !report.memoryError && Boolean(report.eventsFile && report.memoryFile)
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    status: blockers.length ? (report.status === 'running' ? 'in-progress' : 'blocked') : 'needs-review',
    checks, blockers, releaseEligible: false,
    reviewRequired: 'Review the complete journal, inventory provenance, server corrections and independent checks before a stable release.',
    deaths: report.totalDeaths ?? report.deaths?.length ?? 0,
    otherPlayersObserved: report.playersObserved?.length ?? 0
  };
}
