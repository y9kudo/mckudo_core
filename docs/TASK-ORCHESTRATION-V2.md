# Task Orchestration and Recovery V2

This beta2 increment adds dependency scheduling, durable action boundaries and opt-in lifecycle recovery. Schema-1 visual programs and beta1 memory payloads remain readable. A checkpoint records execution history; fresh server observations determine what is currently possible.

## A small dependency queue

Use `createMinecraftAgent` for ordinary visual programs and missions. Use `createAgentManager` for named tasks with dependencies and recovery controls.

```js
import { createAgentManager } from 'overmindmc';

const manager = createAgentManager({
  count: 1,
  names: ['Atlas'],
  worldId: 'my-survival-world', // Keep this stable for this world only.
  memoryDirectory: './data/agents',
  connection: {
    host: '127.0.0.1', port: 25565,
    version: '1.21.1', auth: 'offline'
  },
  recovery: { maxAttempts: 4, baseDelayMs: 500, maxDeaths: 5 }
});

await manager.execute('Atlas', 'connect');
await manager.execute('Atlas', 'tasks', {
  tasks: [
    {
      id: 'tools', title: 'Prepare stone tools', type: 'scenario',
      mode: 'parallel',
      scenario: {
        schemaVersion: 1, name: 'Tools',
        steps: [{
          id: 'pickaxe', type: 'resources',
          targets: { 'minecraft:stone_pickaxe': 1 }
        }]
      }
    },
    {
      id: 'visit', title: 'Visit a waypoint', type: 'action',
      mode: 'parallel', dependsOn: ['tools'],
      requires: { fact: '/inventory/minecraft:stone_pickaxe', gte: 1 },
      action: {
        skill: 'navigate',
        args: { x: 10, y: 64, z: 10, range: 1, bridge: false, excavate: false }
      },
      retry: { maxAttempts: 3, delayMs: 1000 },
      timeoutMs: 12000
    }
  ]
});
await manager.execute('Atlas', 'start');

// Keep the application running. Drain writes and close clients on shutdown.
process.once('SIGINT', async () => { await manager.close(); });
```

Replace the waypoint with a reachable location. Gathering and crafting use the normal kernel; no items or administration commands are injected.

Calling `tasks` replaces the queue and checkpoints. On an application restart, create the same manager with the same `worldId`, name and memory directory, then call `connect` and `start`. Do not call `tasks` again unless you intend to replace the saved mission.

## Scheduling fields

| Field | Meaning |
| --- | --- |
| `id`, `title`, `type` | Stable identity, display name, and `action`, `scenario` or `program` payload |
| `mode` | `sequential` by default; `parallel` makes a task independently eligible |
| `dependsOn` | IDs that must complete first; missing IDs, self-edges and cycles are rejected |
| `requires` | Condition evaluated against fresh facts before proposing work |
| `priority` | Static adjustment from -100 to 100 |
| `priorityWhen` | Up to eight `{ condition, boost }` entries; total adjustment bounded to -100..100 |
| `retry` | `{ maxAttempts: 1..16, delayMs?: 0..60000 }`; consecutive failure limit |
| `timeoutMs` | Per-action cancellation deadline, 100..300000 ms, also constrained by the core deadline |
| `expected` | Observed postcondition for an action task; an unconfirmed effect fails verification |
| `resumePolicy` | `manual` or explicit `recheck` for an interrupted action task |

Sequential tasks have implicit ordering edges. For an explicit graph, use `mode: 'parallel'` and declare dependencies. Eligible tasks share one physical executor. Equal priorities rotate. Dynamic adjustments cannot promote ordinary work above emergency priority 900; emergency decisions retain their priority.

Unknown facts do not satisfy guards, including guards written with `not`. Resource guards check current inventory/facts; they do not reserve items across agents. Retry defaults are one failed action for an action task and six consecutive failures for scenario/program tasks. Success resets the task failure streak. Existing program-node limits also apply. Cancellation does not consume a failure attempt, but may leave an uncertain outcome.

## Durable boundaries

`createTaskQueue({ tasks, skills, resume, checkpoint, scenarioFactory })` accepts an asynchronous checkpoint callback. `queue.checkpoint()` exports `{ schemaVersion: 1, definitionHash, tasks }`. Pass that document as `resume` to restore it. `scenarioFactory(scenario, memory)` must restore the supplied scenario memory.

The standard manager supplies these callbacks. For a custom core, include `queue.reactor` in `reactors` and call `queue.attach(core)`. An arbitrary event emitter can attribute results, but durable dispatch requires the core's awaited reactor hooks.

After `action:start` marks the selected task as running, the core awaits `beforeAction` persistence before physical dispatch. It awaits `afterAction` persistence after the result. A failed pre-dispatch write prevents execution. A failed completion write blocks the queue without emitting a second result for an already successful action.

Checkpoints retain definition fingerprints, status, failure counts, retry deadlines and uncertainty. Nested program branches, loop counters and scenario memories are included. Edited definitions cannot silently reuse newer checkpoints. Legacy task-state arrays remain importable.

### Interrupted actions

A server can accept an action just before a connection fails. Local filesystem transactions cannot make server mutations atomic.

- Running navigation/wait/look actions can execute afresh after restoration.
- An action whose `expected` condition is now observed true completes without replay.
- Other interrupted raw actions stop for reconciliation by default, including item transfers.
- Explicit `resumePolicy: 'recheck'` permits replay after re-observation. Use it only when repeating that operation is acceptable.
- Resource/navigation scenarios reconstruct their controllers and inspect current inventory, terrain and stations.
- Interrupted raw mutations inside visual programs block until explicitly retried.

`taskRetry` and the dashboard's **Retry task** control restart that task from its beginning. Other completed tasks remain intact. Check whether repeating its operations is appropriate.

Historical completion does not guarantee that a tool survives death or a visited location remains accessible. Put required inventory/station/world conditions in later tasks, or use resource scenarios to reacquire them. Restoration of an arbitrary entire survival campaign still needs extended acceptance.

## Memory format and recovery

Agent payloads remain schema version 1. New disk files use a separate versioned envelope with a SHA-256 checksum and generation number. Loading legacy files does not rewrite them; the next save commits the new envelope.

- World hashes and validated names isolate agents.
- Main memory holds bounded model/spatial/settings snapshots.
- A separate task document holds definitions and checkpoints. It is authoritative for the queue even if a crash interrupted a later main-memory save.
- Each document retains one verified previous generation in `.bak`.
- Writes use unique temporary files, file sync and atomic rename. POSIX also syncs the directory; Windows directory syncing is unavailable through this path.
- Same-file writers in one process are serialized. Use one owning process per agent memory directory; concurrent processes require an external lock/database.
- A corrupt primary falls back to a verified backup. `diagnostics(name).recovered` reports recovery of main memory. Damaged files remain untouched until a successful save.
- If both generations fail validation, loading/saving rejects instead of replacing them with empty state.

`createAgentMemory(directory, worldId)` exposes `loadTasks(name)` and `saveTasks(name, { tasks, taskState, taskCheckpoint })` for the task document. Task files are capped at 1 MiB; main memory is configurable from 1 KiB to 16 MiB. The standard manager uses an 8 MiB main-memory budget. JSON commits replace bounded documents; the separate SQLite atlas provides incremental world storage. Credentials do not belong in either store.

## Lifecycle recovery

Recovery is disabled by default. Configuring `recovery` enables bounded reconnect/death recovery after `start`: stop the old executor, save, reconnect or respawn, reconstruct controllers, then inspect fresh observations.

`pause`, `disconnect`, replacing tasks and selecting another goal disable recovery until an explicit `start`. Closing cancels backoff and drains work. One pending recovery per agent, bounded exponential delay, retry budgets and death budgets prevent restart loops.

The reusable `createMissionRecovery({ recover, ...options })` provides the lifecycle guard for custom hosts. Its callback receives `{ reason, attempt, signal }` and must settle the old executor before resuming. Timeouts request cooperative cancellation; a custom executor/callback must honor its abort signal. The core never starts an overlapping physical action to work around an unresponsive executor.

## Dashboard and acceptance

The dashboard shows dependencies, failure counts, blocked reasons, uncertain tasks and recovery state. Visual programs retain schema 1. Dependency queues open in JSON mode to preserve guards, policies and edges; they are never silently flattened into a block program.

Public API tests cover graphs, durable ordering, ambiguous actions, retries/timeouts, nested checkpoints, legacy import, corruption recovery, independent task storage and lifecycle recovery. A local Java 1.21.1 trial executes three verified navigation tasks across automatic reconnection and a separate Node.js process restart, with a second connected client checking positions. This tests movement/persistence, not autonomous survival or Dragon completion. Gameplay drivers, coordinates and journals remain private.
