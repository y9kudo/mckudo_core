# Goals and symbolic planning

OvermindMC can select behavior through rules, authored workflows or desired-state goals. The local symbolic planner needs no language-model account or API key. Created by **y9kudo**.

| Interface | Use it for |
| --- | --- |
| Rules | Reactions to observed conditions |
| Workflows / visual programs | Authored control flow and repeated domain tasks |
| Goals + operators | Choosing an action sequence from explicit prerequisites, effects and costs |
| Resource goals | Minecraft recipes, tool requirements and observed gathering sources |

Priority orders competing decisions. The core validates a planner proposal against its operator model, then rechecks relevant observations before execution. Actual outcomes must be observed; a predicted inventory change does not grant an item.

## Try a local model

```powershell
npm.cmd run demo:brain
```

The example uses [brain.json](../examples/brain.json) and [operators.json](../examples/operators.json). Its simulator demonstrates planning contracts; it does not certify Minecraft gameplay.

## Configure a planner

```js
import {createSymbolicPlanner,buildPlannerContext} from 'overmindmc';

const planner=createSymbolicPlanner({maxDepth:16,maxNodes:4000});
const context=buildPlannerContext({observation,goal,operators,skills});
const proposal=await planner.plan(context,{signal});
console.log(proposal.steps,planner.snapshot());
```

An operator has an ID, an executable action, optional prerequisite conditions, explicit `add`/`set` effects and a positive cost. Every referenced fact must exist when its model operation is applied. The planner accepts up to 2048 operators within its JSON size bound.

Backward causal filtering retains all relevant producers and their prerequisites. A stable binary heap explores the least-cost frontier state. Depth-sensitive state labels preserve shorter alternatives. Search has explicit depth/state limits, yields cooperatively and honors cancellation. An empty proposal can mean a satisfied goal or an unavailable/budget-limited plan; inspect the reason and observed condition.

For Minecraft tasks, `agent.get('minecraft:iron_pickaxe',1)` invokes the domain resource policy instead of requiring you to author every crafting operator. [Planning layers](PLANNING.md) · [API](API.md) · [Visual programs](PROGRAMS.md) · [Learning APIs](RL-PHYSICS-AND-CONNECT.md).
