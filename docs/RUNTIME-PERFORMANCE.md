# Responsiveness OvermindMC and OMConnect

When the agent is visually moving by the push, The reason for this may be delay JavaScript, Curcase handling or game server load. Connect `127.0.0.1` Goes inside the PC. The speed of the external Internet will not accelerate this exchange.

## What's changed in 0.6.0

- OMConnect Finds a way, the approach to the mining block and the search for a lute approach through `planRouteAsync`. Between the portions A* Timers are processed, incoming packages and other agents.
- Local physics plans to call next in relative absolute target time, The timers of the OS should not be rounded up at each interval. Target remains 20 Steps/with; No follow-up steps and packages are implemented after a long pause. The separate game route confirmed 19,97 Not corrected; The full expedition with this schedule hasn't been repeated yet.
- The overall turn of the process rotates the search and limits the sum of the sum to a soft budget 4 ms. One search gets to 64 knots or 2 ms per meal. The individual node ends in its entirety; User `getBlock`, `occupied` and `edgeCost` shall perform short synchronous calculations.
- Cancel is checked between nodes. On-the-spot tracking of the audit of the readings: updating foreign chancs doesn't cancel the calculation. The perpetrator also checks, I'm sure the starting position hasn't changed, and rechecks the support leg when moving.
- In search no longer creates a range of heights for each direction of each node; The known unacceptable diagonal variations do not move.
- Adaptationr stores list ID Items instead of re-copying the entire catalogue. Number of items reread at every observation, missing objects remain zero.
- Survival Planner indexes known sources in a block once per observation. Index dropped at next observation.
- The kernel does not create a picture of the state for the event `state`, If he doesn't have followers. Protection against changes in internal data by subscribers retained.
- Survival and selection errors limit specific action. The failure of one tree makes it possible to check the other immediately.

Queue OMConnect distributes search for traffic within the main stream. OvermindMC separately checks the research routes repeatedly into the present CPU worker. Total work does not disappear, and simultaneous user reactors can still delay the process.

## A real stream of brain processor

`createMinecraftBrain`, simple `createMinecraftAgent` and the expedition `worker_threads` for testing the research points. The reactor immediately returns the wait and continues to take new observations; When you're ready, the brain wakes up at the event. The defense doesn't wait for the search to end. After the interruption, the brain also selects a protection without further pause in 50 ms.

The main stream is a small amount of copy only observed geometry: unknown blocks remain unknown. Worker receives a compact palette and a mass ID Without a network client, current or control. The result shall be checked for measurement, Position, objectives and audits of affected chess. Change of the world cancels the old-fashioned calculation; The driver shall additionally verify the actual supports.

By default, all process agents divide **one** flow, line to **16** objectives and the limits of the old generation JS-(Scoffs) **96 MiB** Total worker. Flows are created in the first task, Reused and not delayed after work is done. Canceling a task that is being performed stops its flow; The pool creates a replacement for the next task. Waiting and counting times are limited together 15 seconds. Disable client cancels his incomplete research.

These are the limits of parallelism, Releases and JS-(Scoffs), Not fixed percentage CPU or the limit of the entire process memory. GPU No search used. Exchange with server and game physics maintain normal rules Minecraft.

For his pool, e.g. multiple agents:

```js
import { createCpuPool, createMinecraftAgent } from 'overmindmc';

const pool = createCpuPool({ workers: 1, memoryMb: 96, maxQueue: 16 });
const agent = createMinecraftAgent({
  name: 'Atlas', worldId: 'my-survival-world',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1' },
  brainOptions: { computation: { pool } }
});
try {
  await agent.run({ schemaVersion: 1, name: 'Stone tools', steps: [
    { id: 'pickaxe', type: 'resources', targets: { 'minecraft:stone_pickaxe': 1 } }
  ] });
} finally {
  await agent.close();
  await pool.close(); // The owner closes his pool after all agents have been completed.
}
```

Maximum — two flows and no more than the logical CPU. Start with one: Game server also uses a processor. `computation: false` Maintains synchronous research mode. Status available `brain.computation.snapshot()`: Requests, Ready/Expired/Miscalculation and overall CPU.

`npm.cmd run test:cpu` compares the same search in synchronous mode and in worker; Report — `data/cpu-responsiveness.json`. Copy geometry and initial download worker are outside the comparison A*. First run 11 October 2026: 13 Candidates tested in each mode, 313,5/332,0 ms search, Maximum burst of the control timer 313,8/16,0 ms. It's a synthetic response test on this PC, not estimate ping, TPS or universal speed of agent.

Choice CPU worker and reused pool based on [documentation Node.js](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html). Mechanism itself `resourceLimits` limits internal JS-total flow; External buffers and the overall memory of the process require separate observation.

## API Search for a route

In the draft, where library installed:

```js
import { planRouteAsync } from 'overmindmc/connect';

const controller = new AbortController();
const view = client.world.createReadView();
const route = await planRouteAsync({
  start: { x: 0, y: 64, z: 0 }, // whole foot position on a known support
  goal: { x: 20, y: 64, z: 10 },
  getBlock: position => view.blockAt(position),
  maxNodes: 3000,
  signal: controller.signal
}, {
  sliceMs: 2,
  nodesPerSlice: 64,
  getRevision: () => view.isCurrent()
});
```

`client` Here — already connected OMConnect. `route.status === 'planned'` means, I'm sure there's a plan, Not that the character came to the target. Use your skills to do it `navigate`. Synchronous function `planRoute` still available. Separate package `kudoconnect` exports the same API.

`getRevision` non-binding. Its value must remain constant during search. `view.isCurrent()` Changed from `true` Total `false`, If the cup read changes; Promise He'll turn it down, Then you need to get a new surveillance. Global peace audit can also be used, But it rejects the search in any change. `signal` stops search, For example, when action interrupts the fight. [The Homeland and Memory](PLATFORM-06.md).

## Pauses after mistakes

For your own reactor, you can specify `failureScope: 'action'` near `id` and `apiVersion`. Then the pause is tied to the skill, and the world. Repeat of the same action remains limited; key order JSON does not allow the restriction to be circumvented. The various action counters are independent, temporary entries limited 1 024 Keys.

Without this parameter, the previous pause for the entire reactor is maintained. In-line survival and rebound reactors use the field and additionally maintain their own memory of unreachable targets.

## How to distinguish the computation delay from the network

```js
const metrics = client.snapshot().metrics;
console.log(metrics.timing);
console.log(metrics.navigation);
```

`timing` measures local timer call intervals OMConnect. The window contains the last 128 interval, So memory doesn't grow with the duration of the session.

| Field | Value |
|---|---|
| `effectiveHz` | Timer call frequency; at interval 50 ms — Near 20 Hz |
| `meanIntervalMs` | Average interval |
| `p95IntervalMs` | 95-% of intervals |
| `maxIntervalMs` | The longest interval in the current window |
| `delayedTicks` | Number of intervals longer 75 ms |
| `samples` | Number of window intervals |
| `ticks` | Timer calls from the last transition to `ready` |

Before the intervals accumulate, numerical estimates are equal `null`. This is **not ping and not TPS Minecraft-servers**. Field `maxTickMs` Under-still shows the maximum time to take a physical step, a `corrections` — server position correction. After the shut-down, the last statistics are left; See also `status` client.

`navigation` — status of the general round A* in the process, Not statistics just about this agent: Number of waiting/completed/error/canceled tasks, number of meals and maximum time. The soft budget is not a cap on interest CPU.

## How Protection defines a real threat

Nearly being behind a stone wall should not stop prey. OMConnect Provides `traceVisibility`: The reduced beam through the railway tracks checks the actual shapes of the blocks, including thin partitions and semi-blocks. Unknown geometry is considered closed. Adaptationer adds `visible` to the nearest entities; OvermindMC does not include pre-emptive protection against hidden baboons. A confirmed Agent damage remains a basis for protection even after the visibility has been lost.

Hunting uses `maxPursuitMs` — default 15 seconds per mine; then the purpose is temporarily excluded and the work is ongoing. It's not a delay in responding to the attack. In the mine, if no safe descent, the agent first checks horizontal branches with confirmed floor. If they're not available, too, He may return to the observed upper stage with the ceiling being checked and choose another passage.

## Check without server

From the source folder OvermindMC:

```powershell
npm.cmd run test:runtime
```

Script `examples/runtime-responsiveness.js` implemented 20 Search in the Artificial World. server, Play accounts and connections not created. The result is retained in `data/runtime-responsiveness.json`. Through `MC_COUNT` You can choose from 1 to 20 Search.

Measurement 11 October 2026, Node v24.19.0, Under 30 000 processed knots in each mode; Automatic tests were performed simultaneously:

| Meteric | Synchronous API | Search With Pauses |
|---|---:|---:|
| Time of calculation | 976 ms | 1 032 ms |
| The longest delay in the control timer | 976 ms | 31 ms |
| Timer activation during search | 0 | 49 |

Both regimes use the same current mode A* And return the same outcome for the same amount of work. This is a comparison of how to implement, Not froze the old version against the new one. Values depend on PCs and load. The parallel search holds several rounds A* In memory, So memory consumption can grow. The result does not confirm the speed of movement, or cooperation in the present Minecraft; selected game results are in Audit log.
