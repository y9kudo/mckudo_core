# Memory, Calculations and Response · 0.6.0

OvermindMC and OMConnect share knowledge and execution. Every customer has his own cups, server equipment and confirmation. The brain chooses goals and actions; transport does not substitute for observed condition. Author — y9kudo.

## The memory layers

| Layer | Appointment | Update |
|---|---|---|
| OMConnect World | Current status of received jar | server packages |
| Spatial memory | Recent observations of resources and stations | Full brain observations; visible contradictions remove the entries |
| No seagoing 12–16–1 | Transfer cost to be trained | Traffic output and loss |
| Neural Planner 24–24–1 | Pocket rating, sources and directions | Affirmative action |
| Line and scenario | Goal, Current phase and outcome | Observations and events of the perpetrator |

Neironets are local, with the updating of weights and limited replay-buffer. They don't generate arbitrary code. The cost of training is complementary to physical and prescription tests; It does not allow unknown or dangerous cells to pass through.

## Spatial memory

```js
import { createSpatialMemory } from 'overmindmc';

const memory = createSpatialMemory({ worldId: 'my-world', maxEntries: 2048 });
memory.observe({
  dimension: 'minecraft:overworld',
  world: { sampledBlocks: [
    { name: 'minecraft:birch_log', position: { x: 12, y: 65, z: 8 } }
  ] }
});
console.log(memory.entries({ dimension: 'minecraft:overworld', names: ['minecraft:birch_log'] }));
const saved = memory.export();
const restored = createSpatialMemory({ worldId: 'my-world', memory: saved });
```

By default, stored until 2 048 coordinates of the 7 day. Limit adjusted from 16 to 4 096, time — from second to second 30 day. The tape has ID block, Measurement, integer coordinates, Last observation time and number of observations. Returned images are copied. Loading Checks format, peace, coordinates and duplicates.

`createMinecraftBrain` defaults to update memory and transmit it to survival. If the cup is off-load, Recording helps to select a direction for research. Before mining and moving, the performer reads the living world. Apparent disappearance/The change in block deletes the clue; An unknown cup keeps it until the expiry of the deadline.

`createAgentManager({ memoryDirectory, worldId })` Saves spatial memory, two models and a line once per 15 seconds and under `close()`. Atomic records are divided around the world and the agent's name. Use it for your vault `brain.spatial.export()`. You can completely unplug this layer through `spatial: false`.

## Total calculation line

A hard-track approach uses one limited process line. Tasks alternate: No more searching 64 knots or 2 ms for your own; the total portion of the round is limited by the soft budget 4 ms. Then the control returns the event cycle. Delay of one node, garbage collection or slow user callback may exceed the budget.

```js
import { createWorkScheduler, planRouteAsync } from 'overmindmc/connect';
const scheduler = createWorkScheduler({ budgetMs: 4, maxJobs: 128 });
try {
  const view = client.world.createReadView();
  const route = await planRouteAsync({
    start: { x: 0, y: 64, z: 0 }, goal: { x: 10, y: 64, z: 0 },
    getBlock: p => view.blockAt(p)
  }, { scheduler, getRevision: () => view.isCurrent() });
  console.log(route.status, scheduler.snapshot());
} finally { scheduler.close(); }
```

`client` In this fragment, already connected. Without own `scheduler` Common. `createWorkScheduler` Also accepts synchronous iters through `submit(iterator, { signal, sliceMs, nodesPerSlice, validate })`. The Line Rejects Overcrowding, Supports the cancellation and releases generators. One problem failed to stop the rest.

Reading shows only the cups, Search affected. Change of the reading cup, Unload, the appearance of a previously unknown cup or the drop of measurement is cancelled. Changes in foreign tubs do not cause the route to be counted. The perpetrator re-checks the position of relevance and each transition. It's a read-in-the-read consistency A*, Not implementation D* Lite.

`client.snapshot().metrics.navigation` Shows the overall process: pending/completed/failed/cancelled, number of meals and the longest serving. These numbers refer to all process agents. [Timer metrics and load methodology](RUNTIME-PERFORMANCE.md).

## Response to events

During the long term, the threat event immediately wakes up the threat verification, without waiting for the next interval. The pack of events is united; One such inspection shall be performed simultaneously. Periodic monitoring remains a stand-by mechanism. Priority fight cancels skill through `AbortSignal`; confirmed changes in the world.

The speed of the event does not guarantee instant physical action: I need a surveillance, calculation, Package processing and next server tick. Measure the local timer, errors and corrections; separate network ping does not replace these figures.

## Sources of project decisions

- [Voyager, Copyright page and article](https://voyager.minedojo.org/): Re-use of experience and feedback from errors. B OvermindMC This is applied to limited observational memory and local education; LLM-Skills generation Voyager Not implemented here.
- [Node.js Performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html): Time measurement and difference between the event cycle and load delays CPU. Line uses `performance.now()`, and the slot intervals are measured separately.
- [Koenig, Likhachev — D* Lite](https://idm-lab.org/bib/abstracts/papers/aaai02b.pdf): Reuse of prospecting in changing the world. Current implementation retained A* and check the relevance of the readings; Incretionary tree D* Lite does not state.

These sources explain the choice of architecture. Results OvermindMC confirmed by their own [Automatic and game tests](TESTING-06.md).
