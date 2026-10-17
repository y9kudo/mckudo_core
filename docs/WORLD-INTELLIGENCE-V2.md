# World Intelligence V2 · Arthas beta2

The kernel now combines a persistent world atlas, frontier exploration and contextual navigation learning. These are library services; OMConnect remains the only owner of the character's physical actions. A saved landmark or route is a suggestion to investigate, never a substitute for the server's current blocks.

## What changes for an application

`createMinecraftBrain` enables `brain.atlas` alongside the existing `brain.spatial` memory. The adapter updates both from observations. Successful and failed navigation events update directed transition history. Block changes invalidate nearby transition hints. The ordinary resource policy uses the atlas when ranking exploration candidates; movement uses the contextual network through the existing navigation cost callback.

Existing `brain.spatial`, `createSpatialMemory`, `planExploration` and the original neural API remain available. Set `worldIntelligence: false` to disable the new atlas/context integration. Set `spatial: false` to disable both spatial memories. `createExplorationPlanner` defaults to the new frontier strategy with the built-in CPU pool; pass `strategy: 'legacy'` to retain the earlier ranking. Older injected CPU pools without the optional `rankFrontiers` method retain their legacy job/result contract.

## Start without managing memory files

```js
import { createAgentManager } from 'overmindmc';

const manager = createAgentManager({
  count: 1,
  names: ['Atlas'],
  worldId: 'my-survival-world',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline' },
  memoryDirectory: './data/agents'
});
await manager.ready;
await manager.execute('Atlas', 'connect');
await manager.execute('Atlas', 'start');

// Read-only diagnostics. The application owns when to pause or close the agent.
console.log(manager.snapshot().agents[0].atlas);
process.once('SIGINT', async () => { await manager.close(); });
```

The manager saves atlas, landmarks, neural weights and tasks every 15 seconds and during orderly shutdown. The outer agent file retains schema 1; its new `atlas` field has its own schema. Existing files without this field still load. The manager uses an 8 MiB file budget; standalone `createAgentMemory` retains its 2 MiB default and accepts a configurable `maxBytes`.

Choose a new `worldId` when starting a different world, even if its address is unchanged. Server address, world ID, Minecraft version and dimension separate evidence. A database or serialized atlas with another identity is rejected. The library cannot identify a replaced server world from its address alone.

## Optional SQLite storage

SQLite is built into supported Node.js runtimes; no external service, API key or GPU is required. JSON persistence through the manager is sufficient for small applications. A long-running application can also supply a world store:

```js
import { createMinecraftBrain, worldAtlasScope } from 'overmindmc';
import { openWorldStore } from 'overmindmc/intelligence';

// `client` is an already connected OMConnect instance.
const scope = worldAtlasScope(client, 'my-survival-world');
const store = await openWorldStore({ path: './data/world.sqlite', ...scope });
const brain = createMinecraftBrain({ client, worldId: scope.worldId,
  worldIntelligence: { scope, store, maxRegions: 512, maxTransitions: 1024 }
});
brain.atlas.hydrate({ dimension: client.state.dimension });
brain.start();

process.once('SIGINT', async () => {
  await brain.stop(); // Flush pending atlas writes before closing the database.
  await client.close();
  store.close(); // The application owns an injected store.
});
```

`hydrate` explicitly loads a bounded set of hints for one dimension. Call it again after changing dimensions if that dimension's history is needed. The brain flushes up to 64 pending atlas records every five seconds during observations and drains its bounded queue when stopped. Standalone atlases expose `flush({ limit })`; there is no hidden persistence timer.

Opening a schema-1 world database transactionally migrates it to schema 2. Observed blocks and air tombstones are preserved, so older observations cannot resurrect a removed block. New region/transition/anchor rows use timestamp-ordered upserts. A different identity or unknown schema rolls the migration back. `store.prune({ before })` removes old blocks and atlas records; applications choose their retention schedule.

## Evidence and return corridors

- Regions are 16 × 16 × 16 cells. Each retains at most 256 distinct sampled positions, 64 hazard positions and a visit count. `observedFractionLowerBound` is explicitly a lower bound; observing one resource does not mark its entire region as loaded.
- Landmarks retain the existing namespaced block/dimension format and TTL. Unknown blocks preserve a hint. Visible contradictory blocks revoke it. Use `brain.spatial.entries(...)` for resource/workstation hints; use `markAnchor` to label an application-observed base, portal or safe location.
- Transitions are directed. A successful drop does not prove that the character can climb back. Damage, successes, failures and measured duration are retained. Edits near an edge invalidate its hint. Temporary occupancy, server corrections and cancelled actions do not become permanent failures.
- `returnCorridor` finds a bounded, directed path through successful hints, with a default zero-damage filter. Its waypoints **must go through fresh local navigation validation**. It returns no collision blocks and does not execute movement. It currently chooses a shortest path by edge count, rather than optimizing total travel time or supplies.

```js
const corridor = brain.atlas.returnCorridor({
  dimension: client.state.dimension,
  from: currentIntegerFeetPosition,
  to: recordedHomeIntegerFeetPosition,
  maxEdges: 512,
  maxDamage: 0
});
if (corridor.status === 'hint') {
  console.log(corridor.waypoints, corridor.requiresRevalidation);
}
const memory = brain.atlas.export();
```

Default budgets are 512 regions, 1024 transitions, 64 anchors and seven days of evidence. LRU/TTL eviction bounds memory. Store batches and caches are bounded independently. Exporting a configured atlas must also fit its 4 MiB serialization limit; the manager's default budgets leave room for its other memories.

## Frontier exploration

`frontierCandidates` examines supported, observed positions on concentric grids. Short rays estimate information gain from unknown boundaries; solid walls occlude those rays. Nearby hazards, recent visits, atlas visit history and application costs reduce a candidate's score. Ore mode additionally favors lower reachable terrain.

`planFrontierExploration` searches similarly ranked candidates together through multi-goal A*. All groups share one total `maxNodes` expansion budget. A promising point across unknown terrain is still rejected. It does not read an unreceived chunk, infer hidden ore or permit an unsupported fall.

In `createExplorationPlanner`, snapshot copying yields to the event loop. Both frontier ranking and A* run in the reused CPU pool. The main thread evaluates at most 64 candidate policy callbacks between worker jobs. The pool receives copied geometry and plain numbers, never sockets or controls. Artificial edges of a copied voxel volume do not count as unexplored world boundaries.

```js
const answer = brain.computation.poll({
  position: client.state.position,
  mode: 'ores', radius: 24, maxNodes: 1500, maxCandidates: 16, maxDrop: 1,
  visited: recentIntegerPositions,
  policyRevision: navigationPolicyRevision
});
// `pending` means computation is running; urgent reactions remain available.
```

Positions, visits, atlas revision, policy revision and relevant observed terrain invalidate cached work. Increment `policyRevision` when changing an application-supplied `candidateCost` without changing those other inputs. A failed search is briefly cached; this service is not a mission retry controller. Time/material reserves and an automatic decision to return home remain the caller's policy responsibilities.

## Contextual navigation learning

The existing 12 → 16 → 1 network remains readable and usable. A second local 24 → 16 → 3 network estimates transition failure, duration and damage. Its additional inputs describe observed support/slipperiness, clearance, speed, water/lava/slow materials, fall height, hazards, nearby hostiles and prior directed-transition history.

Training uses bounded backpropagation/replay: 256 contextual samples and at most nine contextual updates per accepted event. Geometry summaries are cached by dimension/world revision, with a default 1024-entry limit. No model server, paid provider or background GPU process is started.

An untrained or insufficiently supported estimate contributes zero learned cost. The exposed uncertainty value is a conservative similarity/sample-count gate, not a calibrated probability interval. Exact failure penalties include a geometry fingerprint, so an edited passage does not inherit the same temporary ban. Learned costs rank paths that already pass deterministic safety checks; they cannot authorize a path through unknown blocks.

OMConnect captures context before traversing a span. Durations and damage that are only estimated for individual waypoints within a continuous span are masked out of those training heads. A successful action request alone is not a training outcome: the existing executor emits progress/completion events while reconciling received world state.

Neural memory exports schema 3 and imports schemas 1/2/3. Legacy weights and replay stay intact; old broad destination bans are discarded during schema-1 migration. Existing schema-2 directed bans remain readable. Atlas schema 2 also accepts legacy spatial schema 1 as advisory landmarks under an explicitly supplied current scope. Unsupported/corrupt memories fail before use, without mutating their input.

## Validation and current boundaries

Public tests cover directed/invalidated corridors, retention, malformed memories, database migration/tombstones, context learning on held-out coordinate variants, label masking, occlusion, unknown space, shared search budgets, worker cache invalidation and lifecycle cleanup. The installed-package check exercises the new public imports and SQLite persistence.

A non-destructive Java 1.21.1 check passed on the configured local server. A passive client observed 2.014 blocks of movement, less than 0.001 block of final prediction discrepancy, zero corrections and zero damage. The atlas recorded two directed transitions, and its evidence/landmarks survived an on-disk round trip plus reconnection. Two observed transitions are integration evidence, not proof of learned navigation quality. Gameplay drivers, world coordinates and journals remain private.

This increment does not finish fractional-height traversal, mixed transport execution, mission-wide home/supply budgeting, a unified cognitive controller or the autonomous Dragon campaign. Those retain separate acceptance criteria in the [V2 architecture plan](V2-ARCHITECTURE.md).
