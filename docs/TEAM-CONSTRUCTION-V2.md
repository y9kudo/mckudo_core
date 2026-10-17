# Team Construction V2

Connected agents can share one construction project. The core assigns individual cells dynamically, checks observed support, and confirms a cell by reading the expected block from the client's received world. OMConnect moves, selects items and places each block through normal player actions.

## Use the dashboard

1. Connect the participating agents in the same dimension and give them materials. Team storage can distribute stock from an accessible chest.
2. Select a lead agent and upload a schematic in **Program builder → Build a schematic**.
3. Choose **Build together · 16 / agent**. The manager finds an empty supported footprint in received chunks and pauses the workers' programs.
4. Inspect the observed block count below the schematic. Repeat the button to continue another bounded batch.
5. **Pause** on any participating agent cancels the entire active team batch.

The default project ID is `schematic-<lead name>`. Continue with the same lead and connected team. Uploading a new schematic resets the default project after active management stops. Changing an existing explicit project's team or origin requires another `projectId` through the API. Projects stay in memory for that manager's lifetime; they are not automatically persisted as mission checkpoints.

The shared path accepts schematics without block-state properties. Stateful imports are explicitly rejected rather than silently losing their requested properties. The existing single-agent Creative builder retains its separate stateful-placement support.

## JavaScript example

Assume `clients` contains ready OMConnect clients named `Atlas`, `Blake` and `Casey`, in the same known world and dimension, with stone in their inventories. Choose an observed empty site with support underneath.

```js
import {createConstructionProject, runConstructionBatch} from 'overmindmc';

const project = createConstructionProject({
  id: 'shared-floor',
  worldId: 'my-survival-world',
  dimension: 'minecraft:overworld',
  agents: ['Atlas', 'Blake', 'Casey'],
  blueprint: {
    schemaVersion: 1,
    cells: Array.from({length: 12}, (_, i) => ({
      x: 100 + i % 4, y: 65, z: 100 + Math.floor(i / 4),
      block: 'minecraft:stone'
    }))
  }
});
const results = await Promise.all(clients.map(client =>
  runConstructionBatch(client, project, {
    worldId: 'my-survival-world',
    maxActions: 4,
    signal: AbortSignal.timeout(60000)
  })
));
console.log(results.map(r => ({status: r.status, confirmed: r.confirmed})));
console.log(project.snapshot());
// Continue another bounded batch if needed; close the project during cleanup.
```

`worldId` identifies a world instance, not merely an address. Replace it when the server resets its world. The application supplies that identity. Dimension and ready/dead checks run before work and during active leases. To coordinate edits across projects, also install `attachSwarmAgent()` on the clients. Coordinated managers already do this by default.

## Assignment, limits and results

- Maximum: 4,096 placement cells, 4,096 additional constraints, 20 named workers. A manager holds at most eight projects.
- A worker owns at most one cell. Claims expire, renew during execution and use tokens that prevent an old worker from releasing or confirming a newer claim. Default lease: 10 seconds; range: 300–30,000 ms.
- Assignment considers the worker's observed world, its materials, the lowest supported layer and distance. It does not need fixed region filters.
- Unknown targets/support remain unavailable. Occupied targets are conflicts and are never automatically cleared. `air` constraints must be observed empty. `dependent` cells are verified for completion, not independently placed.
- `maxActions` limits placement attempts. Creative inventory staging is an additional ordinary action. Survival receives no injected materials.
- Worker results distinguish `completed`, `partial`, `waiting`, `busy`, `blocked` and `needs-materials`. A waiting worker can return while a teammate is still placing; inspect the final shared snapshot before declaring project completion.
- The default failure budget is two unconfirmed attempts per cell across workers; configurable range: 1–10. An error followed by the correct observed block is reconciled as confirmed. Executor success without that block consumes a retry.
- Cancellation releases a claim without recording a placement failure. Losing the lease or world context aborts the physical executor.

Clients can receive observations at different times. A worker may encounter a teammate's just-placed block or time out after a world change. Re-observation reconciles these cases. Claims are advisory permissions, not server transactions or an exactly-once guarantee. Existing reach, geometry, protected-region and single-executor checks remain active.

## Checkpoints and diagnostics

Save `project.checkpoint()` with your application's storage and pass it as `checkpoint` when recreating the project. It contains schema version 1, a fingerprint of the project/world/dimension/blueprint, and bounded per-cell failure budgets. Import is limited to 4 MiB; saved failure messages are limited to 120 characters.

Restoration imports neither completed cells nor active leases. It starts with unknown terrain and proves progress again from newly received blocks. Mismatched project inputs are rejected. A saved success cannot prove that a changed or reset structure still exists.

`snapshot()` exposes counts, observation time, active claims and up to 128 preview cells, prioritizing unfinished work. `truncated` marks omitted detail. Use `snapshot({maxCells: 4096})` for full bounded detail or `maxCells: 0` for counts and leases only. These are latest-observation counts, not an authoritative live server map.

`manager.snapshot().construction` contains the same diagnostics. After importing a schematic to the lead, programmatic callers can run:

```js
await manager.execute('Atlas', 'buildTogether', {
  names: ['Atlas', 'Blake', 'Casey'],
  projectId: 'floor-one',
  origin: {x: 100, y: 65, z: 100},
  maxActions: 8
});
```

Manager batches allow 1–32 attempts **per worker**, standalone batches 1–4,096. The manager validates consistent participants/origin, waits for workers to settle, and propagates pause, death, disconnection and shutdown cancellation. Single-agent schematic batches now also honor management cancellation. The single-agent Creative builder retains its cell failure budget between management batches and reconnects.

## Evidence and scope

Public API tests cover concurrent ownership, support dependencies, material shortage, unknown/conflicting terrain, stale tokens, renewal, cancellation, false executor success, error reconciliation, checkpoints, diagnostic limits and manager pause behavior.

A local Java 1.21.1 Survival trial distributed 18 prepared cobblestone blocks between three agents and built an 18-cell floor across resumed batches. A separate passive client observed all 18 blocks. Materials were conserved, unrelated chest stock was preserved, and no damage or position corrections occurred. An occupied-target rejection and a confirmation timeout were reconciled during the trial. Gameplay drivers and world journals remain private; API regressions remain public.

This increment does not automatically acquire every material, solve arbitrary structural dependencies, coordinate flight traffic or prove a full Survival campaign. It adds a reusable shared construction service under existing execution rules.
