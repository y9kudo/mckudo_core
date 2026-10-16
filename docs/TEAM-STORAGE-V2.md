# Team Supplies and Storage V2

Manager teams now use a shared withdrawal policy instead of automatically emptying a nearby chest. Each agent opens a real storage window, obtains its confirmed contents, and asks the kernel how much it should take. OMConnect performs the existing exact, acknowledged inventory operations. Planning never writes items directly into an inventory.

## Configure a team

```js
import { createAgentManager, startDashboard } from 'overmindmc';

const manager = createAgentManager({
  count: 3,
  names: ['Alice', 'Blake', 'Charlie'],
  worldId: 'my-world',
  connection: {
    host: '127.0.0.1', port: 25565,
    version: '1.21.1', auth: 'offline'
  },
  // Desired TOTAL quantities per agent, including what it already owns.
  supplyTargets: { 'minecraft:apple': 2, 'minecraft:iron_pickaxe': 1 },
  brainOptions: { storage: { radius: 32, maxStacks: 4 } }
});

const dashboard = await startDashboard({ manager, port: 4180 });
console.log(dashboard.url);
process.once('SIGINT', async () => { await dashboard.close(); });
```

Connect and start each agent through the dashboard. Each still runs its ordinary survival program; nearby storage is an additional source of supplies. A team storage check has priority 35, ahead of ordinary resource gathering at priority 20, while emergency policies retain their priorities.

Teams with coordination enabled install `storage.mode: 'team'` by default. A standalone brain keeps its previous `all` default. Choose `storage: false` to disable automatic storage checks, or `storage: { mode: 'all' }` to explicitly retain the previous take-all policy. Manual `lootChest` calls also retain their existing behavior.

`radius` controls storage discovery, from 1 to 64 blocks. `recheckMs` controls revisiting remembered storage, with a 60-second default and a 1-second minimum. `maxStacks` limits confirmed source-stack operations, not a team's total item entitlement. Partial stacks can require several acknowledged clicks. `items` can restrict which item IDs are considered.

## How the quantities are chosen

The allocator considers connected, living team members in the same dimension within 32 blocks of the storage. Paused members remain eligible; disconnected, dead and distant members do not reserve a share. The registered team defines membership, rather than every player visible on the server.

For each available item it reads current inventories, worn armor and cursor contents. It fills the lowest existing stock toward each member's desired total. When one item cannot be divided equally, a stable name ordering breaks the tie. An agent above the current shared stock level leaves the scarce item for teammates.

| Existing apples | Chest contains | Planned withdrawal |
| --- | --- | --- |
| Alice 0, Blake 0, Charlie 0 | 6 | 2 each |
| Alice 6, Blake 0, Charlie 0 | 6 | Alice 0, Blake 3, Charlie 3 |
| Each has 0; each wants at most 8 | 64 | 8 each; 40 remain |

The calculation is repeated after each agent obtains a fresh window, under its existing resource reservation. It does not reuse a teammate's old view of the chest. Existing server-side slot/cursor confirmations and component-aware capacity checks still determine what actually transfers.

Without explicit targets, bounded defaults cover ordinary food, fuel, wood, building stock, tools, armor, a shield, a bed and a few supplies. Equivalent food/wood variants share a reserve. A better material-tier tool or worn armor normally removes the need to take another lower-tier piece. Unrelated items remain in storage. Explicit targets, including zero, override the defaults for the specified item.

These defaults are practical supply rules, not a complete utility model for enchantments, durability, special components or every Minecraft item. Existing equipment and survival policies still decide how to use obtained supplies.

## Goals, classes and transfers

Resource scenarios pass their active original targets into allocation. A request for `#logs` therefore accepts available wood species instead of inheriting one concrete tree selected by a mining plan. The policy supports OMConnect's registered block classes and the built-in `#planks` item group. Unknown classes fail explicitly. Class budgets are 16 selectors and 4,096 total member entries per agent.

This increment leaves another agent's share in the chest. It does not pick up everything and promise a later donation. Existing `shareTeamSupplies`, `proposeTeamTransfer` and manager auto-trade remain available for actual surplus already held by an agent. Partial deliveries remain recorded without automatic replay. `distributeStorageSupplies` remains an explicit sequential batch helper for caller-defined deficits.

## Standalone allocation API

```js
import { createTeamStorageAllocator } from 'overmindmc';

// clients are your OMConnect clients for the same server/world.
const supplies = createTeamStorageAllocator({
  worldId: 'my-world', clients,
  defaults: false,
  targets: () => ({ apple: 2, iron_pickaxe: 1 })
});
const detach = clients.map(client => supplies.attach(client));
try {
  await clients[0].execute({
    skill: 'takeStorage',
    args: { x: 12, y: 64, z: 8, allocation: 'team-supplies' }
  });
  console.log(supplies.snapshot());
} finally {
  detach.forEach(stop => stop());
  await Promise.all(clients.map(client => client.close()));
}
```

Use [Swarm Coordination](SWARM-V2.md) attachments as well when standalone clients access the same storage concurrently. The manager installs both services. A standalone allocator alone does not lock a chest.

`clients` accepts a fixed array or a callback returning current clients, useful when replacing a connection. The service supports 1–20 unique client names, up to 128 target keys per agent, quantities 0–4,096, and bounded diagnostic history for 20 agents. `maxDistance` accepts 1–128 blocks. `allocate({agent, dimension, position, contents})` is also available as a pure proposal API for custom integrations; its input is not authenticated world evidence.

OMConnect exposes an optional `storagePolicy` hook independent of the kernel. A `takeStorage` action with `allocation` requires a matching installed policy. The hook runs synchronously after opening a confirmed window and returns at most 128 quantities. Missing policies, invalid quantities, duplicate aliases and asynchronous results are rejected. Item filters and explicit `amounts` remain ceilings; an empty allocation performs no clicks. Dynamic allocation cannot be used for deposits or combined with `all: true`.

## Diagnostics and boundaries

`manager.snapshot().storageAllocation` and the dashboard show the latest **planned** withdrawal and planned shares for others. Per-action ceilings and capacity can further reduce a proposal. These are not transfer receipts, guaranteed reservations of quantities, or proof that a teammate has collected its share. Returned action receipts and current inventories provide the actual result.

The policy uses observations from clients in one process. It has no omniscient server inventory or persistent warehouse ledger. Outside players, deaths, eating, item drops and external storage edits can change the situation between operations. Current possession and desired totals drive the next allocation; this is not historical fairness accounting. Container cooldowns can delay revisits after supplies change.

## Verified behavior

Public tests cover scarce/excess stock, owned and equipped items, class goals, bounded 20-member allocation, ordering against a unit-by-unit oracle, confirmed concurrent window operations, invalid/empty policies, filters and manager integration.

A local Java 1.21.1 trial used the standard storage reactors of three agents with empty inventories. They discovered the prepared chest and each acquired exactly two apples and one iron pickaxe from its six apples and three picks. Final inventories plus storage conserved all nine items; damage and position corrections were zero. Ordinary acknowledged deposits returned the supplies for repeatable testing. Raw gameplay drivers, coordinates and journals remain local QA data. This is a supply-distribution check, not a Survival campaign result.
