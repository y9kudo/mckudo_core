# Cognitive Intelligence V2 · Arthas beta2

The cognitive service connects existing rules, reactors, workflows, symbolic goals and learning to one decision cycle:

**Observe → Understand → Plan → Act → Verify → Reflect → Replan**

It does not own a connection, write packets or run another movement loop. OMConnect still executes actions and applies physical checks. The symbolic model predicts possible effects; only new observations can confirm them.

## Start with the existing agent API

```js
import { createMinecraftAgent } from 'overmindmc';

const agent = createMinecraftAgent({
  name: 'Rowan', worldId: 'my-survival-world',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline' }
});
try {
  await agent.get('#logs', 2);
  console.log(agent.snapshot().brain?.cognitive);
} finally {
  await agent.close();
}
```

The standard Minecraft brain enables cognitive decisions and read-only verification by default. Existing resource recipes and survival policies continue to generate their own admissible proposals. The service chooses between proposals; it does not replace the resource dependency solver with a neural network.

For the lower-level `createCore` API, opt in with `cognitive: {}`. Its default remains the existing priority-based behavior. Set `cognitive: false` in `createMinecraftBrain` to retain that behavior there too. `adapterOptions.verifyResults: false` disables the added Minecraft outcome verifier; goal/operator and executor checks still apply.

## Names and responsibilities

| API | Purpose |
| --- | --- |
| `brain.cognitive` | Shared action arbitration, bounded context history and decision journal |
| `brain.cognition` | Existing local 24 → 24 → 1 neural planner; risk estimates and training |
| `brain.neural` | Navigation learning, including the contextual transition model |
| `brain.atlas` | Scoped regions, landmarks, directed route history and frontier hints |
| `createCognitivePlanner` | Compare completely validated symbolic proposals from configured providers |

The dashboard's **Diagnostics** tab shows the current decision phase, candidate costs and the latest decision events. These are observable facts, estimates and rejection reasons. The API exposes the same data through `snapshot().cognitive` and `trace.cognitive`.

## Arbitration and urgency

Priorities are hard ordering constraints. A cheaper task cannot outrank a higher-priority task. Equal-priority ordinary tasks can be ranked by a trained model, local failure history and measured duration. A small commitment margin reduces unnecessary switching.

Priorities of 900 or higher retain their original ordering and skip learned assessment. Urgent defense polling remains independent of learned ranking. Urgent observations can cancel cooperative symbolic planning, after which the core observes again before choosing another action. The previous planner must acknowledge cancellation before another action starts.

Unknown/uncertain estimates add no learned cost. Invalid model estimates are recorded as diagnostic errors and fall back to deterministic ordering. Unsupported skills, cooldowns, unmet observed prerequisites and blocked goals remain inadmissible. The default engine retains at most 256 context records and 64 journal entries; at most 64 candidates receive neural assessment per ranking request.

```js
const brain = createMinecraftBrain({ client, worldId: 'my-world',
  cognitive: { maxEntries: 256, maxAssessments: 32, commitmentMargin: 0.5 }
});
```

## Expected effects and verification

Reactors can declare `requires` and `expected` using the existing condition format:

```js
const reactor = {
  id: 'prepare-planks', apiVersion: 1,
  react(observation) {
    const current = observation.inventory?.['minecraft:oak_planks'];
    if (!Number.isInteger(current)) return { action: null, reason: 'Plank count is unknown.' };
    return {
      priority: 20, reason: 'Prepare one recipe batch.',
      requires: { fact: '/inventory/minecraft:oak_log', gte: 1 },
      action: { skill: 'craft', args: { item: 'minecraft:oak_planks', count: 4 } },
      expected: { fact: '/inventory/minecraft:oak_planks', gte: current + 4 }
    };
  }
};
```

This is a small explicit contract example; ordinary resource goals continue to use the catalog and wood classes automatically. Missing prerequisite facts block the proposal. An explicit expected result that remains unconfirmed produces `EFFECT_UNCONFIRMED` rather than completing the task.

The optional adapter method `verifyAction(action, { before, after, signal })` returns `{ status, reason }`, where status is `confirmed`, `unconfirmed` or `unknown`. The Minecraft adapter additionally checks craft/smelt output growth, destination range and targeted block changes in the live world. Missing a block from a sampled list does not prove it became air. Some skills have no generic verifier; their executor and explicit goal contracts retain responsibility. Inventory growth is a consistency check, not independent causal attribution to one action.

Goal completion still requires the desired observed condition. Every symbolic step's modeled effects are checked before its remaining plan can advance. A verified intermediate step may return `progress`; it now contributes a successful action sample instead of silently disappearing from neural learning. Cancelled, transient and unverified intermediate outcomes are excluded.

## Local plan repair

Symbolic goals can retain a useful suffix after an assumption changes or a strategy fails. The repair service searches a short connector using currently available operators, validates every precondition/effect and checks that the combined proposal still reaches the modeled goal. Completed prerequisites can be skipped. A failed source can be replaced while retaining later crafting steps.

```js
const core = createCore({ config, adapter, cognitive: {},
  planning: {
    operators,
    repair: { maxNodes: 128, maxDepth: 4, maxSuffixes: 8, maxRepairs: 4 }
  }
});
```

Repair defaults to these budgets when cognitive decisions are enabled and remains disabled by default in legacy `createCore`. `repair: false` explicitly disables it. Exceeding a connector budget falls back to full planning under its existing call/rate limits. Per-goal caches preserve independent tails, and relevant changed facts revoke temporary operator failure penalties. Server corrections and temporary occupancy do not blacklist an operator as permanently unusable.

Repair yields to the event loop, projects relevant facts to reduce copying, includes depth in its visited-state key and honors cancellation. It finds a bounded feasible repair, not a globally optimal replacement plan. `snapshot().brain.repairs` reports attempts, retained/connector steps and full-planning fallbacks. Generic symbolic goal repair does not yet replace every specialized resource/scenario recovery policy.

## Symbolic, HTN and MCTS proposals

The new portfolio planner implements the existing `Planner` interface. Each provider returns operator IDs; every complete proposal passes `validatePlan` before scoring. Modeled inventory and known prerequisites must be sufficient for the whole plan. Predictions never mark the actual goal as achieved.

```js
import { createCognitivePlanner, createSymbolicPlanner } from 'overmindmc';

const planner = createCognitivePlanner({
  planners: [createSymbolicPlanner({ maxNodes: 2000 })],
  assess: (observation, action) => brain.cognition.assess(observation, action),
  budgetMs: 100
});
```

Supply this object as `planning.planner` when creating a core with symbolic goals. Up to four unique providers share one deadline. Validated proposals are compared by operator cost plus sufficiently supported learned costs. The default symbolic planner identity remains unchanged unless the application explicitly selects a portfolio, preserving existing goal-checkpoint fingerprints.

`createHTNPlannerAdapter({ planner, tasks })` adapts existing HTN methods/primitives. Its proposed actions must map unambiguously to available operators and reach the modeled goal. `createMCTSPlannerAdapter({ planner, completion })` validates an MCTS first action and requires symbolic completion. Applications still supply HTN domain methods and an MCTS model; these adapters do not invent a complete Minecraft domain.

Providers receive copied JSON and an abort signal, never the executor. Invalid proposals are rejected, and an earlier validated proposal can survive a later provider timeout. Custom providers must cooperate with cancellation; arbitrary JavaScript that ignores a signal cannot be forcibly stopped inside this process. No provider or paid LLM request is created implicitly.

## Training, held-out evaluation and checkpoint selection

`createNeuralPlanner({ mode: 'evaluate' })` performs inference without training. `model.setMode('evaluate')` freezes that model in place; `setMode('train')` resumes training. Neural planner memory exports schema 2 and imports schema 1 without losing its weights/replay. Navigation neural memory remains a separate format.

The core emits `experience:transition` with copied before/after observations, action, observed outcome, duration, verification status and a `session:counter` episode ID. `environment` identifies an OMConnect/Mineflayer adapter as `minecraft`; custom adapters are `external`. It is adapter metadata, not proof that a full-game objective succeeded. Applications can collect these events in a bounded external recorder while leaving the executor unchanged.

```js
const records = [];
core.on('experience:transition', sample => {
  records.push(sample);
  if (records.length > 256) records.shift();
});
```

Use separate core sessions/environments for training and evaluation. Models retain 2048 recent episode hashes for duplicate detection and up to 64 training-session namespace hashes to keep split isolation after the recent window rolls over. For external data, use `training-run:episode-number` IDs. Missing legacy provenance or an exhausted namespace budget makes automatic promotion inconclusive; it never silently certifies disjoint data.

```js
import { evaluateCognitiveCheckpoint } from 'overmindmc';

const result = evaluateCognitiveCheckpoint({
  baseline: savedBaseline,
  candidate: trainedCandidate,
  evaluation: { split: 'evaluation', source: 'minecraft', records: heldOutRecords },
  minSamples: 16, minImprovement: 0.001, maxRegression: 0.01
});
// result.memory retains the baseline unless the candidate qualifies.
// Activate the selected checkpoint explicitly when constructing the next model/brain.
```

Evaluation compares frozen copies using Brier error for failure predictions. Known training overlap and duplicate episode IDs are rejected. Promotion requires sufficient held-out samples, complete tracked provenance, overall improvement and no excessive regression in a dimension represented by at least four samples. `source` must explicitly distinguish `unit`, `headless` and `minecraft`; source labels are application-supplied and remain visible in results. The function returns the chosen memory without mutating a running model or writing a file.

This is a gate for the cognitive risk predictor. It is not a global freeze/promotion mechanism for navigation, DQN/PPO/SAC or every agent policy, and prediction accuracy alone does not establish better gameplay.

## Persistence and reproducible checks

Cognitive context history has a separate `schemaVersion: 1`, `kind: cognitive-engine` envelope. Generic core exports preserve their outer schema and append the optional field. The agent manager persists it alongside atlas, task and neural memories. Old checkpoints without it still load. In-flight operations are not silently resumed by this addition.

```powershell
npm.cmd run check
npm.cmd run test:types
npm.cmd run benchmark:cognition
npm.cmd run release:check
npm.cmd run test:package
```

The comparison command uses explicitly labeled unit fixtures and disjoint training/evaluation episodes. It reports held-out errors, arbitration timings and repair work. It does not connect to Minecraft or simulate full physics.

A non-destructive Java 1.21.1 integration check completed two route checkpoints with one symbolic planning call. The first verified action returned `progress`, the second completed the observed goal, and both produced neural training samples. A passive client confirmed both positions with less than 0.001 block discrepancy, zero corrections and zero damage. This is a short integration check, not evidence of long-distance survival or an autonomous Dragon victory.
