# Brain OvermindMC: objectives and objectives Planner

OvermindMC Adoptes the purpose and builds a sequence of actions, and the game adapter performs the action chosen. In-line symbolic Planner is locally operated: Language model, Keys API and no fee-paying services required.

## Three Ways to Ask for Behavior

| Method | When to Use |
|---|---|
| `rules` | Repeated Response: Eat in the Hunger |
| `workflows` | Known modus operandi and dependence |
| `goals` | Acquired result; The order is chosen Planner Model of operators |

Candidates are compared by `priority`. With equal priority, the rules go ahead of tasks, objectives — before the objectives. Reactions are implemented between actions, Not interrupt arbitrary action in the middle. Before delivering the result Planner Core rereads the world: change of significant facts or the emergence of a higher priority reaction postpones action to the next tick.

The objective describes the state of support. When her `desired` implemented, She gets `achieved`. If the result disappears from the inventory, The kernel may be scheduled again within the remaining space `maxActions`. Use it for a single task workflow or stop the application after achieving the target.

## Quick launch

From the root of the original:

```powershell
npm.cmd run demo:brain
```

Example uses [brain.json](../examples/brain.json) and [operators.json](../examples/operators.json). From empty inventory, he gets a verstock and four sticks for six moves of the simulation. Initial state changes planning results: If there are boards, No need to get extra wood.

## Imports to the Annex

Put the library on your local route app, as described in [README](../README.md). Copy to the application `brain.json` and `operators.json` from examples. Specify `"type": "module"` to his `package.json`.

```js
import { readFile } from 'node:fs/promises';
import { createCore, createSymbolicPlanner } from 'overmindmc';
import { createSimulator } from 'overmindmc/adapters/simulator';

const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const core = createCore({
  config: await read('./brain.json'),
  adapter: createSimulator(),
  planning: {
    operators: await read('./operators.json'),
    planner: createSymbolicPlanner({ maxDepth: 16, maxNodes: 2000 }),
    maxCalls: 100,
    minIntervalMs: 250,
    retryDelayMs: 1000
  }
});
core.on('decision:trace', trace => console.log(JSON.stringify(trace)));
core.on('action:finish', result => console.log(result));
core.start();
process.once('SIGINT', async () => { await core.stop(); });
```

If `planner` missing, used `createSymbolicPlanner()`. For Minecraft replace simulation with `createMineflayerAdapter` After the client has appeared in the world. [Ready Launch for 1.21.1](LIVE-1.21.1.md).

## Purpose and operator format

Objectives require `schemaVersion: 3`. Example of a separate objective:

```json
{
  "id": "get-table",
  "priority": 10,
  "maxActions": 32,
  "desired": { "fact": "/inventory/minecraft:crafting_table", "gte": 1 }
}
```

Operator describes one known way to change the world. It's a model of results, which is tested after actual operation:

```json
{
  "id": "make-planks",
  "cost": 1,
  "requires": { "fact": "/inventory/minecraft:oak_log", "gte": 1 },
  "action": { "skill": "craft", "args": { "item": "minecraft:oak_planks", "times": 1 } },
  "effects": [
    { "fact": "/inventory/minecraft:oak_log", "add": -1 },
    { "fact": "/inventory/minecraft:oak_planks", "add": 4 }
  ]
}
```

`requires` — Preconditions; `effects` — Expected changes; `cost` — Contingent value of 1 to 1000. Lower cost preferable. It's not a monetary price or a guaranteed time of execution. `add` changes the number fact, `set` Acquires the primitive JSON. Interception effects are prohibited. Action requires a master's skill, for the calculation of the effect — A known observation.

Planner reschedules possible cost states with limits on depth and state quantity. In a limited search, he may not find the existing plan; the result clearly indicates that the budget is exhausted. Optimality of the plan found during the search-off is not guaranteed. Only oak knows the catalogue of examples, boards, And the sticks: He doesn't open the recipes himself.

## Verification and reconfiguration

1. The core watches the world and checks out the reactions, objectives and objectives.
2. Planner Receives a copy JSON: Observation, Objective, accessible operators and skills.
3. Response checked before execution: unknown ID, Wrong premises and plan, Not achieving the model target, Reverse.
4. Only the first plan operator is being implemented. Then the core reads the world again.
5. If the expected impact is consistent, the remaining plan is maintained. Significant changes in the world make it count.

Unconfirmed effect is considered to be a failure. Operator temporarily excluded by four `retryDelayMs`, Target waiting one `retryDelayMs`; This allows an alternative operator to be tried. It's a temporary feedback on a mistake, not training a new skill model.

One successful intermediate step has a result `progress`, achieving the entire goal — `success`. Errors — `failure`, cancellation — `cancelled`. Attempts to act are limited `maxActions` (1–256 for purpose); the cancelled attempt does not spend this limit. Between actions `core.retryGoal(id)` Clearly drops the target's state and action counter. Challenges budget Planner He doesn't throw away.

## Replacement Planner and LLM

The module contract: `{ id, apiVersion: 1, plan(context, { signal }) }`. `plan` Returns JSON-object `{ steps: ['operator-id', ...], reason?: 'Brief explanation' }`. An empty list means no plan. Maximum — 64 steps. Only operators from the transferred directory can choose the answer; Arbitrary code and new arguments of skills not being fulfilled.

For a local or external language model, the developer implements `plan`: Serializes `context` In the request of its provider, transmits cancellation, Sees the answer as JSON And returns the object. `buildPlannerContext` Available separately to form the same verifiable context. `validatePlan` Available for separate response check. SDK Provider and network queries are not included in the core.

`maxCalls` Limiting the number of calls `plan`, `minIntervalMs` — frequency. Challenge, completed by error or cancellation, It counts, too. The rest of the plan is being used without a new call. The counter is stored. Settings Limits the challenges of the module, but does not guarantee the cash budget or the current limit: It's a duty to integrate with the provider. Module — trustor JavaScript in the process; The kernel does not isolate it from the network or file system.

## Observation and memory

`snapshot().brain` contains objectives, The remaining plan and call counter. `snapshot().trace` and event `decision:trace` The number of the tick is shown, rules that have worked and have not worked, to 32 Comparisons, Locking of candidates and selected operator. This is a verifiable route of facts and decisions, Not the inner reasoning of neurosnets. Only the last track is stored; History application can write itself.

`exportMemory()` With the brain connected returns format 3, Without brain — format 2. Challenges and actions counters maintained, Status of objectives, history and workflows. The list of the plan and the temporary exemptions of operators does not continue: After re-start, we need a new plan from fresh observation. Goal, stored during operation, Recovers as `interrupted` and demands verification of peace and `retryGoal`.

Memory is checked by target print, operators and ID Planner. Changing these definitions requires a conscious migration or a new memory file. [FileMemory](API.md) doesn't keep the game world itself.

## Automation modules 0.4

Planner Supplements replacement Reactor, Catalogues and block classes, Resource planner, spatial routes, Nutrition, Protection and construction. They use common core performer and fresh observation. `createResourceReactor` Works with catalog recipes, a GoalBrain — with designated operators and their effects. These models can be combined by priority. Description API and implementation: [AUTOMATION.md](AUTOMATION.md).
