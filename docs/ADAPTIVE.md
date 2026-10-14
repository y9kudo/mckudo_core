# Experience, Revision and cooperation

OvermindMC Responsible for decisions; Independent OMConnect Provides observations and implementation. These modules work with other adapters. Author: **y9kudo**.

## The withdrawal of operators

Operator describes assumption: Under certain conditions, the action will change the facts. Developer requests, What to Measure, And the effects calculate the core from the observations before and after the action. You don't need a recipe catalogue for this.

```js
import { createCore, createExperienceModel } from 'overmindmc';

const experience = createExperienceModel({
  worldId: 'my-server',
  facts: ['/inventory/minecraft:birch_log'],
  contextFacts: ['/dimension', '/world/nearbyBlocks/minecraft:birch_log'],
  minEvidence: 3
});
const core = createCore({
  config, adapter,
  learning: experience,
  planning: { operators: knownOperators, experience }
});
```

Here `config` contains `goals`, `adapter` — connected performer, a `knownOperators` — Initial rules (Yes, yes `[]`). For learning through rules, clean it up without purpose `planning`, Leave it `learning`. No experience yet, A planner with an empty list of operators cannot operate: The first episodes give the rules, Scenario or Developer.

Core Re-observes the World After Action. Numerical changes become effects `add`, Change the row/boolean — `set`. After three consistent different episodes of hypothesis, available to the planner. Unknown facts are not considered zero, cancellation is not considered a failure, repeated `episodeId` does not increase the evidentiary value. `worldId` models and Core shall coincide.

`operators()` Returns available rules; `snapshot()` — hypotheses, confidence and a magazine. `assess(action, observation)` returns state and temporary lock after error. The smooth duration of successful action is involved in the cost of the plan.

**The observation hypothesis doesn't prove cause.** Another player can drop an object during extraction. Therefore, the training is clearly included, The context is given by the application, and the effects of each plan continue to be tested. `confidence` — smooth share of agreements, non-statistical guarantee. Memory limited; Permanent model storage and verified import of foreign experience has not yet been implemented.

## Review after failure

Error or inconsistency immediately removes the hypothesis from the planning. The model increases the pause for the pair «Action + context». New sustainable effects replace old after re-observation. The waiting of the agent is corrected, Not server mechanics.

Failure does not mean, I'm sure the plot is forever in the dark. Add to `contextFacts` Measurement, status of purpose, threat or audit of the area under study. The constantly changing clock will make each episode a context. Budgets and pauses Core still in force.

## Adaptation scenario

```js
import { createAdaptiveScenario } from 'overmindmc';
const task = createAdaptiveScenario({
  id: 'get-wood', model: experience,
  desired: { fact: '/inventory/minecraft:birch_log', gte: 1 },
  strategies: [
    { id: 'pickup', when: { fact: '/custom/dropVisible', eq: true },
      action: { skill: 'collect', args: { item: 'minecraft:birch_log' } } },
    { id: 'gather',
      action: { skill: 'gather', args: { block: 'minecraft:birch_log', count: 1 } } }
  ]
});
// createCore({ config, adapter, reactors: [task.reactor], learning: experience })
```

`/custom/dropVisible` — example of the fact of the annex; Standard adapter doesn't automatically create it. For purpose «any wood» use resource scenario with `targets: { '#logs': 1 }` or add an aggregate class counter to the observation.

Policies are checked in sequence. If conditions change or action is blocked after error, Another way is chosen. Goal `desired` retained. `snapshot().journal` explains the changes. Translates the plan under review; new JavaScript not generated and not implemented. Completion requires observed achievement of the goal.

## Cooperative without a common distributor

Create `createFleet`, Individual Core For every client and give him `peer` in `createAdaptiveScenario`. Strategy with `resource: 'tree/area-1'` First, spreads intent. The selected participant begins work; The rest of you can choose another strategy. The intention is extended, released on change of task and expired on stop of agent. At the end of the application, call `task.dispose()`.

Transport OMConnect does not set targets: Each brain decides on its own on what is available. Game chat not used. If you lose contact, you can have conflicting solutions; Additional confirmation report required for irreversible operation of the annex.

[Example of learning without Minecraft](../examples/learning.js) · [Real Client Group](../packages/omconnect/examples/team.js) · [Initial scenarios](SCENARIOS.md)
