# Team Coordination V2

This beta2 increment coordinates agents managed by one Node.js process. It adds temporary reservations for observed resources and short ground passages, connects resource tasks to the existing peer claims, and preserves a user's pause during automatic trading. Every client still receives its own world observations and executes through its existing OMConnect action job.

## Start with the manager

For a manager containing two or more agents, coordination is enabled by default. The single-agent facade leaves it disabled. You can configure it explicitly:

```js
import { createAgentManager, startDashboard } from 'overmindmc';

const manager = createAgentManager({
  names: ['Alice', 'Blake', 'Charlie'],
  count: 3,
  worldId: 'my-survival-world',
  connection: {
    host: '127.0.0.1',
    port: 25565,
    version: '1.21.1',
    auth: 'offline'
  },
  cooperation: { capacity: 256, ttlMs: 1500, maxWaitMs: 1500 }
});

const dashboard = await startDashboard({ manager, port: 4180 });
console.log(dashboard.url);
process.once('SIGINT', async () => {
  await dashboard.close();
});
```

Open the printed address and use the Connect, task editor and Start controls for each agent. Select an agent's diagnostics to inspect its current reservations and waits. Calling `manager.execute(name, 'pause')` stops that agent's current action and releases its reservations after cancellation settles.

Use a stable `worldId` for the same world. Use a different value for a different world. A coordinator belongs to one server/world; do not attach clients from different servers to it. For independent agents, set `cooperation: false`.

## What a reservation means

A lease is a short-lived permission to use a named resource. Acquisition checks all requested keys together: it grants the complete set or grants none. Different dimensions have independent keys. An earlier overlapping waiter has precedence once the holder releases its lease; a holder can renew an unchanged active lease until its action finishes.

| Operation | Coordinated scope |
| --- | --- |
| Explicit `dig`, `gather`, `place`, `ignitePortal`, `fillEndFrame` with coordinates | The addressed block cell |
| Explicit `lootChest`, `inspectStorage`, `takeStorage`, `depositStorage`, `labelStorage` | Addressed storage and the possible partner of a double chest |
| Same-level ground `walk` | Current cell and up to three upcoming route cells, their body/support cells, unordered edges and diagonal crossings |
| Resource scenarios | Existing peer claims for chosen mining targets, including claims that expired while paused |
| Automatic exchange | Existing confirmed item delivery; resume only unchanged run intent and the same brain instance |

The sliding path window comes from the validated route. It does not reserve a guessed straight line. Coordinated ground navigation disables corner shortcuts that leave that route; ordinary same-direction walking can retain velocity. Personal-space steering remains limited to the reserved route and current supported terrain.

If a passage is reserved, movement stops and waits in cancellable 25 ms intervals. The default wait budget is 1.5 seconds. Expiry of that budget reports transient `OCCUPIED`; it does not label the terrain permanently impassable or train a navigation failure. Geometry is checked again after waiting. Changed support, an actual player body or a server correction can still stop the route.

Path requests give up their previous passage when blocked by a different reservation. This reduces holding one passage while waiting for another. A stationary player in a one-block corridor can still prevent progress; this increment does not implement a fleet-wide deadlock-free traffic planner.

## Standalone clients and custom applications

OMConnect stays independent of OvermindMC. The optional hooks are installed by the library, not imported by the client:

```js
import { createSwarmCoordinator, attachSwarmAgent } from 'overmindmc';

const coordinator = createSwarmCoordinator({
  worldId: 'my-survival-world',
  members: ['Alice', 'Blake']
});
// alice and blake are your OMConnect clients for this same server/world.
const detachAlice = attachSwarmAgent(alice, { coordinator });
const detachBlake = attachSwarmAgent(blake, { coordinator });

try {
  // Use the normal client.execute(...) API here.
  console.log(coordinator.snapshot());
} finally {
  // Detachment aborts reserved work; close waits for the existing job to settle.
  detachAlice();
  detachBlake();
  await Promise.all([alice.close(), blake.close()]);
  coordinator.close();
}
```

`attachSwarmAgent()` returns an idempotent cleanup function. It rejects an unknown member or a client that already has coordination hooks. The optional `name` must match a configured member. A manager installs and cleans up its own attachments; do not attach the same clients again.

The lower-level service exposes `acquire`, `reservePath`, `renew`, `release`, `releaseAgent`, `cancelWait`, `snapshot` and `close`. Release checks both owner and token. A replaced or expired token cannot release a newer grant. An explicit-resource action renews its 5-second lease every second; a lost lease cancels that action. Reconnecting manager clients receive fresh attachments.

| Option | Budget |
| --- | --- |
| `members` | 1–20 unique Minecraft names |
| `capacity` | 1–1,024 active leases; default 256 |
| `ttlMs` / explicit `durationMs` | 100–30,000 ms; service default 1,500 |
| `maxWaitMs` | 0–5,000 ms; attachment default 1,500 |
| Resource request | 1–64 keys, each at most 180 characters |
| Path request | 1–8 adjacent integer positions at one ground height |

One agent holds at most one lease of each kind (`resource` and `path`). Resource keys such as `cell/12,64,-8` and path keys are internal coordination addresses, not trusted world facts. Waiters expire after 30 seconds of inactivity and are removed on cancellation. Snapshots are copies and cannot modify the coordinator.

## Execution and storage boundaries

Reservations are advisory within this process. They are not a server plugin, a distributed lock, an anti-collision guarantee or proof that a block/item exists. A long event-loop stall can delay lease renewal. Server inventory/window confirmations, world protection, actual entity occupancy and collision/support checks remain authoritative.

Only explicitly addressed actions and same-level walking receive these reservations. Implicit workstation selection, internal excavation/placement substeps, flight, jumps and drops do not become fully coordinated by this increment. Container geometry can change during an operation; a lease cannot make external world edits atomic.

Exclusive chest access does not divide its contents fairly. `lootChest` retains its existing take-all behavior. For deficit-based allocation, use `distributeStorageSupplies({ clients, requests })`; for beneficial transfers, use the existing `shareTeamSupplies`/trade policies. Do not interpret a reservation as a promise that an agent will donate everything it takes.

The existing peer transport exchanges intents without Minecraft chat. This service does not add shared omniscient terrain, distributed execution or automatic joint mission/role assignment. A custom action coordinator is a trusted permission extension: it must honor cancellation and invoke its provided dispatcher exactly once. OMConnect rejects missing/duplicate dispatch and waits for a started dispatch before releasing the action job.

## Verification

Public API tests cover atomic grants, scope isolation, token fencing, expiry, waiter order, reverse/diagonal conflicts, cancellation, lost leases, unknown double-chest partners, support changes during waiting, manager integration and manual pause during auto-trade. A physics-backed test exercises normal ground execution through the sliding window.

A short local Java 1.21.1 trial used three agents. Each moved along an observed supported ground route and another client confirmed its position. One agent waited for a deliberately held passage reservation before moving. All three finished without damage or position corrections, and no leases or waiters remained. The trial did not mine, build, trade or complete a Survival campaign. Raw gameplay drivers and journals remain local; API regressions stay public.
