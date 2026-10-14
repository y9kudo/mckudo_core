# Agent contract OMConnect v1

Author: y9kudo. API exported from `kudoconnect`; Type description in [index.d.ts](../index.d.ts).

## Life cycle

`createOMConnect(options)` Creates one client. `await connect()` Completed after receiving entry, Health and the cup under the player. One copy used for one session. `await close()` Cancel, turns off the physics and closes the jacket. Even if you're excluded, call `close` in `finally`.

Parameters: `host`, `port`, `username` (offline: nick 1–16 Latin letters, numbers or `_`; Microsoft: Cash identifier), `version: '1.21' | '1.21.1'`, `auth: 'offline' | 'microsoft'`, `viewDistance: 2..32`, `connectTimeoutMs: 1000..60000`. For Microsoft available `profilesFolder`, `authTimeoutMs`, `onMsaCode` And the manifest `realms.realmId`: [management](AUTHENTICATION.md). The requested range is limited to server settings.

## Observation

`observe()` Returns a separate copy JSON with `contract: 'omconnect.agent'` and `version: 1`. Fields:

| Field | Value |
| --- | --- |
| `self` | Position, speed, angles in degrees, Health, Hunger, Measurement, Status of connectivity and media |
| `inventory` | Non-zero quantities only `minecraft:item`; missing object means 0 |
| `entities` | From the server of substance, Position, speed and health, When known |
| `world` | Measurement, Cache change number, Number of cups loaded |
| `combat.attackers` | Recent sources of damage, supported by a server package |
| `drops` | Observed items on the ground |

`world.blockAt(position)` returns the block or `null`, If unknown. `findBlocks({ classes: ['#logs'], position, radius: 64, properties: { axis: 'y' } })` Only looking for it in the cups it received. The result contains distances and `truncated`: No finding proves no block. `registerClass('building', ['stone', 'cobblestone'])` Adds class. `blockUpdate`, `chunkLoad`, `chunkUnload` available at `client.world`.

## Actions

`await execute({ skill, args }, { signal, priority })` has one perpetrator. The high priority action cancels the current one and waits for the release of the performer. Equal/Less priority for a busy client is rejected. `AbortSignal` Rescission of waiting and next operations; The server's confirmed changes are not rolling back.

| Skill | Example `args` | What's being tested |
| --- | --- | --- |
| `gather` | `{ block: '#logs', count: 1 }` | Production and growth of the subject |
| `dig` | `{ x: 5, y: 64, z: 2 }` | Real change in block |
| `collect` | `{ item: 'minecraft:birch_log', timeoutMs: 8000 }` | Increase in inventory; disappearance is not enough |
| `goto` | `{ x: 5, y: 64, z: 2, range: 1 }` | Movement on observed support; server corrections can interrupt it |
| `place` | `{ x: 5, y: 64, z: 2, block: 'cobblestone' }` | Block, received from server |
| `shoot` | `{ entityId: '42', weapon: 'bow' }` | The shell/ammunition consumption; `hitConfirmed: false` |
| `drop` | `{ item: 'birch_log', count: 1 }` | Reduced inventory, not being received by another player |
| `eat` | `{ item: 'bread' }` | Reduction in food and increased food availability |
| `guard` | `{ durationMs: 400 }` | Request for shield; not proof of blocking the damage |
| `attack` | `{ entityId: '42' }` | Impact in permissible distance; Not proof of damage |

`shoot` Supports normal/Spectro-metrical/Augmentation arrows; Arbala fireworks are off-line. Combating skills require `allowPlayer: true` for purposes-Players. `describe().skills` — Actually available skills. Don't count any authorized Promise proven by a change in the world: See result fields.

## Extension

```js
const client = new OMConnect(options, {
  createProtocolClient: options => myTransport(options),
  physics: (state, controls, getBlock) => myPhysics(state, controls, getBlock)
});
client.registerSkill('inspect', async (args, { client, signal }) => {
  signal.throwIfAborted();
  return client.observe();
});
```

The protocol must implement the interface used `minecraft-protocol`: Package events, `write`, `end`, `state`, `socket`. Transport substitution does not in itself add support for other game versions. User skills must take into account the cancellation signal and complete; The kernel does not start the next action in parallel with the uncompleted previous.

## Data exchange

`createFleet({ count: 1..10 })` Manage connection and delivery of messages in one process. If one client's entrance failed, All the clients already open are closing. The default list of names is exported as `DEFAULT_AGENT_NAMES`. For reproducible tests, pass the clear array `names`.

`OMPeer` Received `id`, `team`, list `peers`, function `send(envelope)` non-binding `clock`, `settleMs`. Message contains a version, group, sender, recipient, sequence, theme, JSON-load and expiry time. Message Limited 16 KiB, TTL 100–30000 ms; Refill memory limited. `receive` Checks the group, recipient, TTL and repetition. Transport between different processes should ensure the authenticity of the sender and the agreed time: It's not built-in security against fake network packages.

The transmission of the wood message does not carry wood. For physical exchange, the application brings agents closer together, implemented `drop`, then `collect` and check both the inventors; Another player can pick up the subject first. No automatic atomized transmission of items.

## Diagnostics

`metrics` contains the number of packages, actions, Errors, adjustments, Maximum tick time and decoder warning. `trace` Keeps the Last 128 actions, outcome and duration. `subscribeUrgent` Signed for her own loss; Returns the function of the write-off. Developments `action`, `warning`, `fault`, `entity`, `damage`, `end` Available through `on`.

## New actions and life cycle

- `equipArmor { item }`: Select object and confirmed change of relevant slot. `inventory.equipment()` shows the armor, `ownedCount(item)` includes it in the quantity.
- `prepareBed {}`: Search for a suitable bed, or craft and installation from accessible materials.
- `sleep { x?, y?, z?, maxWaitMs? }`: Night Overworld, approach, sleep confirmation; waiting is limited 1–30 seconds, Then the awakening. No coordinates first call bed preparation.
- `time.timeOfDay`, `state.sleeping` and developments `time`/`sleep`/`wake` reflect server data.

- `craft { item, count }`: New subjects, rounding before lot; 2×2 Or the verstex 3×3.
- `ensureStation { station, gather? }`: Wearing or baking; Find, Create and Set.
- `smelt { item, count, input?, fuel?, fuelCount? }`: Normal furnace, result confirmed by server.
- `findStorages({ radius: 64, count: 32 })`: chests, Double chests, barrels, shakers; the result `truncated`.
- `lootChest { x, y, z, maxStacks: 54 }`: take the available contents within capacity.
- `lookAt(position, { turnSpeed: 540 })` and `waitForLook()`: smooth turning and waiting.
- `navigate { x, y, z, sprint?, sprintJump?, bridge? }`: Automatic acceleration and bridge in the known world.
- `respawn({ timeoutMs: 15000 })`: Only from `state.status === 'dead'`; Waiting for a living condition and a cup.

Detailed management: [craft and movement](CRAFTING-MOVEMENT.md).

## Falls and measurements in 0.5.0

`assessFall({height, health, landing, minHealthAfter:6, maxDamage:6})` Returns the loss forecast, health balance, `survivable` and `allowed`. `landing` — Observed block. The usual armor doesn't reduce the calculated impact of the fall. Unknown support, Dangerous blocks, Liquids and uncontrolled mucus rebounds are rejected.

Client Options: `maxDrop` (1–32, In navigation default 16), `fallHealthReserve` and `maxFallDamage` (0–20, default 6). Allowable height does not mean mandatory jump: route checks total damage, Landing and current health before descent. Evaluation does not simulate all effects and charms.

| Action | Arguments | Confirmation |
| --- | --- | --- |
| `ignitePortal` | `origin: {x,y,z}`, `axis: "x"` or `"z"` | A famous frame 4×5 and the emergence of portal blocks |
| `fillEndFrame` | `x,y,z` | Property `eye: true` server block |
| `throwEye` | `{}` | Object flow and only observed flight |
| `enterPortal` | `x,y,z,dimension` | New Measurement, position, Health and the loaded cup |

`throwEye` Repels the shot with another player closer 24 blocks: The server nature of the eye does not give a secure field to the owner. Latest 32 observations available in `observe().endgame.eyes`.

The transition retains the server equipment; Current properties and cups replaced by new measurement. Rebirth after death remains separate `respawn()`. The client does not set the coordinates for the portal and does not send the administrator's command.
