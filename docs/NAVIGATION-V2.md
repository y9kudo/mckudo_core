# Navigation V2

The first beta2 increment adds optional stateful planning around the existing A*. The kernel chooses goals; OMConnect still owns the connection, movement and action confirmations.

## Basic use

Ordinary applications can keep using `client.execute({skill:'navigate', args:{x,y,z}})`. OMConnect divides a distant target into bounded segments. Action timeouts still apply to the whole request; choose an application deadline appropriate to the distance.

For applications that own planning separately:

```js
import { createNavigationSession } from 'overmindmc';

const navigation = createNavigationSession({
  getBlock: position => client.world.blockAt(position),
  getRevision: () => client.world.revision,
  scope: {
    server: '127.0.0.1:25565', worldId: 'my-world',
    dimension: 'minecraft:overworld', minecraftVersion: '1.21.1'
  }
});

try {
  const segment = await navigation.plan({
    start: { x: 0, y: 64, z: 0 },
    goal: { x: 1000, y: 64, z: 0 },
    maxNodes: 4000, signal: abortController.signal
  });
  console.log(segment.status, segment.partial, segment.target);
  // The application executes through OMConnect and observes the actual new
  // position before asking for another segment. A plan is not completed travel.
} finally {
  navigation.close();
}
```

`getBlock` must return live observed geometry or `null` for unknown cells. `getRevision` must change when that geometry changes. If no revision is supplied, cache validation compares saved observations. Occupancy, learned costs and world-edit callbacks bypass route caching unless the planner can prove their identity; existing action safety remains active.

`plan` returns at most one local segment. `finalGoal` retains the requested target; `segmentGoal` identifies the intermediate target. `partial:true` means the overall target is still pending. A new request cancels an obsolete in-flight request. Search scheduling and node limits remain available.

## Regional search

`RegionalRouteGraph` stores directed connections. `IncrementalRegionPlanner` implements LPA* with a zero heuristic on that graph. A zero heuristic trades heuristic guidance for a simple exact baseline on the bounded regional graph. Changed edge costs and removed connections update shortest-path labels without discarding all prior work.

A graph path is a hint for choosing a local destination. It does not permit walking through an unloaded chunk or bypassing collision checks. Directed connections do not imply a safe reverse drop or an available portal.

## Memory

`navigation.exportMemory()` returns a separate `schemaVersion:2` envelope. Save it with the application's existing transactional store and pass it as `memory` to a new session. The server, world, dimension and Minecraft version must match. Entries expire, imports are size-limited, unknown schemas are rejected and imported routes require a fresh local search.

Beta1 core memory, visual programs and neural model schemas are unchanged. Do not replace those documents with the navigation envelope. Keep every stored file under an ignored application data path.

## Geometry, predictions and recovery

- `collisionShapes`, `bodyBounds` and `supportAt` expose the common collision contract, including partial support heights. `null` geometry never becomes safe air.
- `predictMotion` runs 1–20 existing physics ticks on copied state. It sends no packets, grants no movement and cannot confirm a server result.
- `createMotionProgress` detects insufficient progress toward a local endpoint. Runtime navigation reports this as `STUCK`.
- `createNavigationRecovery` maps failures to bounded recovery decisions. It does not execute suggested actions. A safe-position hint still needs a live route check before use.
- The kernel's navigation goal blocks repeated failures for an unchanged context after its retry budget. A changed relevant observation or explicit `resetRecovery()` allows reconsideration.

The first increment keeps conservative integer-height ground nodes. Geometry queries support more shapes than the current ground executor can traverse. Automatic door use, general fractional-height routes, mixed transport planning, parkour and MPC are not inferred from a successful volume query.

## Reproduce checks

```powershell
npm.cmd run check
npm.cmd run test:types
npm.cmd run benchmark:navigation
npm.cmd run release:check
npm.cmd run test:package
```

Offline benchmarks report planning latency, expansions, CPU and memory. They include long synthetic routes, terrain, bridges, excavation, dynamic obstacles and concurrent planners. Cases outside the current ground model explicitly expect safe rejection. They do not measure actual travel time, combat damage, deaths or server corrections. Run those measurements separately on an explicitly configured test server.
