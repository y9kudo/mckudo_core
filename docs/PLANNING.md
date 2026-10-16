# Planning in OvermindMC

Created by **y9kudo**. The public API composes several bounded planning layers. Predicted effects never replace received Minecraft observations.

## Choose the appropriate layer

| Layer | Inputs | Output |
| --- | --- | --- |
| Campaign | Scenario stages, current dimension, inventory and confirmed milestones | Current domain objective |
| Resource policy | Recipe book, item classes, usable tools, stations and observed sources | Next gathering, crafting, smelting or construction action |
| Symbolic planner | A goal condition and explicit operators with prerequisites, effects and costs | A validated sequence of operator IDs |
| OMVectorize | Observed geometry, candidate destinations, tools, building stock and movement constraints | A bounded spatial route |
| OMConnect | Route/action and live state | Executed inputs and observed outcomes |

HTN, MCTS and learning policies remain available through the intelligence API. A provider's predicted outcome does not authorize inventing inventory or bypassing collision checks. Applications can replace a layer while retaining the same execution contract.

## A resource goal

```js
import {createMinecraftAgent} from 'overmindmc';

const agent=createMinecraftAgent({
  name:'Atlas',worldId:'my-world',
  connection:{host:'127.0.0.1',port:25565,version:'1.21.1',auth:'offline'}
});
try {
  await agent.get('minecraft:iron_pickaxe',1,{timeoutMs:600000});
} finally {
  await agent.close();
}
```

The resource policy obtains prerequisites from the connected catalog rather than a launcher-authored recipe sequence. Class selectors such as `#logs` allow the available wood species. Consumables, usable tool tiers and required stations affect the next action. The current campaign retains its observed starting area so shelter preparation can return from a deep mine through goal-level navigation.

## One spatial search for many destinations

```js
import {planRouteToAnyAsync} from 'overmindmc';

const route=await planRouteToAnyAsync({
  start:{x:0,y:64,z:0},
  goals:[{x:10,y:64,z:0},{x:0,y:64,z:12}],
  getBlock:position=>client.world.blockAt(position),
  maxNodes:6000,maxDistance:128,signal
});
if(route.status==='planned')console.log(route.selectedGoal,route.cost);
```

Supply 1–128 candidate feet positions. A single A* frontier considers them together and chooses a reachable destination by route cost. A farther coordinate can win when a nearer one needs a long detour. The node budget is shared across candidates. Duplicate goals share labels; unknown cells, occupied positions, unsafe falls and protected edits remain constrained.

`OMVectorize.planGroundToAny` and `planGroundToAnyAsync` expose the same operation. The multi-goal search currently uses the sliced JavaScript executor; the C backend retains its supported single-goal fast path. OMConnect uses the shared search when selecting a standing position for block interaction, then transfers the validated route through its expiring one-use handoff. It rechecks terrain, permissions and live positioning during execution.

## Large symbolic domains

`validateOperators` accepts up to 2048 operators within a 4 MiB JSON bound. `createSymbolicPlanner` defaults to 2000 generated states and depth 16; applications may configure up to 100000 states and depth 64.

Before state search, the planner walks backward from goal facts through every possible producer and its prerequisites. Unrelated operators are excluded from that search. A stable binary heap selects the least-cost frontier state without repeatedly sorting the entire queue. Depth remains part of a visited-state key, preserving valid shorter plans when a cheaper longer prefix also exists.

`planner.snapshot()` reports total/relevant operators and generated/expanded states. Search yields to the event loop and honors cancellation. Increasing a budget can increase latency and memory; it is a deliberate application choice. The platform does not turn a large configured limit into an unbounded search.

## Research context

The implementation uses general planning principles and original JavaScript/C code. [D* Lite](https://publications.ri.cmu.edu/d-lite) motivates reusing information across related navigation problems; a full D* Lite implementation is not claimed here. [Voyager](https://arxiv.org/abs/2305.16291) separates curriculum, reusable skills and environment feedback; its GPT-driven system is different from this local resource controller. [Baritone's published feature description](https://raw.githubusercontent.com/cabaletta/baritone/master/FEATURES.md) documents segmented paths, preplanning and composite goals as practical navigation requirements. No Baritone source code is included in these changes.
