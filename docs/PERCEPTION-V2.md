# Perception and Combat V2

This beta2 increment separates fast threat observation from broad resource scans, records bounded change evidence and stabilizes combat target selection. It retains perception schema 1, existing action skills and server-verified execution. It does not complete all of the V2 combat, cooperation or construction roadmap.

## Default Minecraft integration

The standard Minecraft brain uses the updated OMConnect adapter automatically. It exposes `brain.perception` for change metadata and `brain.combatPolicy.snapshot()` for current combat focus. The manager and dashboard diagnostics display these summaries.

```js
import { createMinecraftBrain } from 'overmindmc';

const brain = createMinecraftBrain({
  client, // Your connected OMConnect client.
  worldId: 'my-world',
  adapterOptions: {
    searchRadius: 192,
    perception: {
      maxEntities: 512,
      maxChanges: 128,
      maxRays: 24,
      visibilityDistance: 48
    }
  },
  defense: { focusMs: 600, switchMargin: 1.5 }
});
brain.start();
console.log(brain.perception.snapshot());
// Later: await brain.stop(); await client.close();
```

`searchRadius` queries already received world data. It does not force the server to send additional chunks. `visibilityDistance` is a ray-check limit, not a guarantee that blocks/entities at that distance are loaded.

## Incremental change evidence

`createPerceptionTracker` is an independent metadata service:

```js
import { createPerceptionTracker, semanticCategories } from 'overmindmc';

const tracker = createPerceptionTracker({ maxEntities: 512, maxChanges: 128 });
tracker.setScope('minecraft:overworld');
tracker.observeEntity({
  id: '42', name: 'cow', position: { x: 3, y: 64, z: 2 }
});
console.log(tracker.evidence('42'));
console.log(semanticCategories('minecraft:deepslate_iron_ore'));
// ['ores', 'deepslate_ores']
```

The adapter subscribes to entity updates/removal, block changes, chunk loads/unloads and connection world resets. Repeated updates to the same entity/block/chunk coalesce into its newest event. Entity records and journal entries have separate capacity limits. Revision numbers and received/coalesced/dropped counters expose incomplete history.

Changing dimension clears the current entity evidence and journal. Counters describe the service lifetime. This metadata is ephemeral and is not serialized as authoritative terrain or entity state.

Categories overlap: leaves belong to both `tree` and `leaves`; deepslate ore belongs to `ores` and `deepslate_ores`. These lightweight name categories support diagnostics. The connected registry and full block taxonomy remain responsible for executable resource planning and mod-specific definitions.

Evidence includes its source, age and a heuristic freshness score. Packet evidence starts at 1; imported connection-cache evidence starts at 0.8. Age reduces the score. This is not a calibrated probability of visibility, hostility or future position. A stationary entity remains in the authoritative connection cache until the server removes it; an old evidence timestamp alone does not invent an entity removal.

## Bounded entity and visibility work

The adapter retains at most 128 entities per observation. A bounded heap selects relevant entities before serialization: approaching projectiles, observed ranged aim, recent attackers, hostile mobs, players, other entities, then drops. Distance breaks ties inside each group. Large groups of nearby dropped items therefore do not erase a more distant approaching arrow or hostile mob from the threat view.

Selection inspects the received entity set; it does not ask the server for hidden entities. The independent loot observation still serves item collection.

At most `maxRays` new visibility rays run per read. Results are cached for at most 250 ms only when the exact source/target positions, dimension and world revision match. Changed geometry or movement requires another check. Each ray traverses bounded voxel geometry and checks actual block shapes.

An exhausted ray budget, distant target or unloaded geometry produces `visible: null` and an explicit reason. Known occlusion produces `false`; an observed clear corridor produces `true`. Decisions may conservatively raise a shield on incomplete evidence, but physical attack/navigation executors still perform their own reach, geometry and target checks.

Axis-aligned rays on integer block faces check both adjacent cells. Previously this tie could let a ray pass along a wall as if every intersected block were transparent. Unloaded adjacent geometry stays unknown.

## Resource scan invalidation

Resource samples retain the existing movement-cell and two-second freshness limits. An event outside the sampled radius, or a known edit involving only untracked block types, can reuse those resource samples. Relevant tracked edits, nearby chunk changes, unknown edit metadata and world/position changes invalidate the sample.

Geometry and visibility invalidation remain independent: an untracked stone edit can leave a tree-name sample reusable while still invalidating rays and routes. This optimization never treats an unloaded block as air and does not make a cached target executable without a live check.

## Fast defense and target commitment

`observeThreats` now carries fresh owned inventory in addition to health, shields, entities and attributed attacks. Previously a preemption check omitted weapons/ammunition, so the controller could falsely classify an equipped agent as unarmed and choose retreat. This path does not trigger a full terrain/resource scan.

Combat holds an already admissible target for up to `focusMs` when a similar-distance rival becomes slightly nearer. `switchMargin` limits the tolerated distance difference. Failure clears that focus. Expiration, lost eligibility, a fresh attributed hit or a confirmed hostile creeper within five blocks permits immediate reselection.

Commitment never grants permission to attack a neutral player. Existing trusted-player rules, retaliation thresholds, urgent projectile guarding, low-health retreat, ranged restrictions and observed-damage requirements remain in force. Longer tactical encounters, richer cover evaluation and broader PvE/PvP acceptance remain subsequent work.

## Lifecycle and verification

Standard brain stop/end releases perception subscriptions; starting again attaches them once and imports the connection's current entity cache. A custom adapter host must call `adapter.dispose()` when finished. The adapter can reactivate on a later observation, consistent with its existing reusable lifecycle.

Run `npm run benchmark:perception` for a deterministic synthetic 4,096-entity selection/budget/coalescing check. Its timings measure CPU work, not Minecraft reaction latency or combat strength. Public tests cover independent heap ordering, dense-drop priority, ray budgets, invalidation, boundary geometry, inventory-aware defense and target permissions.

A short local Java 1.21.1 trial verifies another connected player's movement, packet evidence, neutral-player safety and removal after logout. A second client provides the position reference. Gameplay drivers and detailed journals remain private. This trial does not establish a PvP victory, survival campaign or Dragon completion.
