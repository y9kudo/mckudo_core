# Standard behaviour, chests and interaction

OvermindMC Chooses, Why and When to Act. OMConnect Receives game observation and performs actions with server response checks. These facilities are located in libraries; files to `examples` Show connection and check.

## The brain profile is ready

From the root of this project, you can start `node examples/minecraft-agent.js`. Example connects Henry Local offline-server Java 1.21.1. Conclusion — Ctrl+C. Address, port, The world name and identifier change variables `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_WORLD`.

Minimum code inside project:

```js
import { createOMConnect } from './omconnect/index.js';
import { createMinecraftBrain } from './overmindmc.js';

const client = createOMConnect({ username: 'Henry', host: '127.0.0.1', port: 25565 });
const brain = createMinecraftBrain({ client, worldId: 'my-survival-world' });
await client.connect();
brain.start();

process.once('SIGINT', async () => {
  await brain.stop();
  await client.close();
});
```

When installing trained npm-Packages of imports replaced by `kudoconnect` and `mckudo`. The release of the packages has not yet been completed. Details of self-sustainment: [OMConnect](../packages/omconnect/README.md).

`createMinecraftBrain` Returns the normal `OvermindCore`: available `tick`, `start`, `stop`, `snapshot`, developments, Skills and plagins. Brain creation doesn't open the connection; `connect()` implement the annex. The brain stops don't close the client — Can be transferred to another system.

By default, the profile includes:

- Protect from observed hostile obs and respond to two confirmed strikes **one** player for the last 10 seconds. The agents in charge are players and obey this rule. The strikes of the different attackers do not add up; An unknown source of damage does not turn into a fictional enemy.
- Tactical battle with priority 990: Weapons selection, Impact recovery, board if fitted, non-derogable in case of hazardous health. The defense can interrupt extraction and rebound from the chest. Threat verification interval — 50 ms; The real delay also depends on the network, server tick and cancelable action.
- Checking the nearest monitoring chest, chest-Traps, barrels or shalcker in a radius 16 blocks. Selection permitted in health higher 8 and a free place. After inspection, recheck — Not before 60 seconds. Craft-A trap can activate the surrounding mechanism: You're gonna have to rule out these blocks from your policy on trap maps.

It's a basic behavior profile, Not ready complete passage. He doesn't make tools out of nothing: The selection of the tool uses the already available equipment. Anti-craft, Stations, the smelting and the survival cycle is described in [NATIVE-SURVIVAL](NATIVE-SURVIVAL.md).

## Settings without Logic

```js
const brain = createMinecraftBrain({
  client,
  worldId: 'my-survival-world',
  defense: {
    retaliationHits: 2,
    trustedPlayers: ['y9kudo'],
    retreatHealth: 8
  },
  storage: {
    radius: 24,
    recheckMs: 60000,
    maxStacks: 8,
    items: ['minecraft:bread', 'minecraft:iron_pickaxe', 'minecraft:iron_axe']
  },
  config: {
    workflows: [{
      id: 'wood',
      steps: [{ id: 'collect', action: { skill: 'gather', args: { block: '#logs', count: 2 } } }]
    }]
  }
});
```

`trustedPlayers` excludes the names from the response PvP without register. `defense.attackPlayers: false` Disables counter-attacks on players. `storage: false` Disables the self-search of the chests, while retaining the possibility to call `lootChest` Obviously. `items` — permitted ID items; if no list, permitted selection of any contents. `maxStacks` limit the number of requests for change for action, not the number of items.

You can add your logic to it by `reactors`, a Objectives and rules — Through `config`. The priority of independent selection from the chest is 10. Challenges, to be implemented first, Give more priority. For existing application c `createCore` Individually exported `createStorageReactor` and `createCombatReactor`; in total `createCore` behaviour not included hidden.

## How an instrument is selected

`dig` and `gather` assess the hardness of the block, material, Acceptable instruments for resource deposition and baseline time of destruction. So the axe is chosen for birch, for stone — Kirk, and the wooden kirch is not considered suitable for diamond ore. Use a specific slot of the selected tool, including the situation of two identical objects and different wear and tear.

`combat` compares swords and axes by basic damage during recovery; The observed raised enemy shield increases the preference for an axe. If there is no weapon, An empty arm is chosen. If all the equipment is full and the arm is not available without throwing away, Act indicates error. Switch does not eliminate the game speed limits of recovery and recovery. Full appreciation of charms, Effects and server modifications not yet implemented.

The change of slot on the quick access panel goes straight away. The item from the main inventory is moved to the hand with the server confirmation awaited. `chooseMiningTool(registry, block, items, { held, onGround })` available separately in OMConnect for preliminary assessment.

## A clear action with a chest

```js
const result = await client.execute({
  skill: 'lootChest',
  args: { x: 12, y: 64, z: -3, items: ['minecraft:bread'], maxStacks: 4 }
}, { signal: AbortSignal.timeout(30000), priority: 10 });
console.log(result.transferred);
```

The perpetrator approaches the block, Opens the window, receives the contents and sends them through shift-click. Success in transfer requires **reduction of the initial glass and increase of the equipment**. Unconfirmed request does not add items to the local model. The inventory can only take part of the glass. The window closes when canceled, items already received remain with the agent.

Supported by regular/Double chests, barrels and all 17 Schalker options. The furnace serves a separate skill `smelt`. Ender-chest, Contribution of items, Trade windows and precise limitation of the quantity inside the glass require additional performers. If the window is not permitted by the server, closed by other action or not available, Request ends with error. Error after partial transfer does not mean backset: Check the current inventory before re-checking.

`client.observe().storage` Keeps to 128 Last inspection with measurement, coordinates, Time and contents. These are observations, Not a guarantee of the relevance of a closed chest. The profile does not start a conservative examination without free slots; A clear one `lootChest` Also knows how to supplement suitable incomplete stitches.

## Players, Eyes and Meetings

```js
console.log(client.players.snapshot());
const watch = client.watchPlayer('Ivy', { durationMs: 10000, maxDistance: 16 });
// Later, When attention is no longer needed:
watch.stop();
```

The player on the server list may be too far away: Then `observed: false` and `position: null`. Coordinates are used only after the game is acquired. The look is tied to UUID, takes into account movement and eye height, stops when the obstacle is, The player disappears or leaves over the radius. Fight, Mining and navigation have an advantage over social view.

```js
import { previewInteraction, runInteraction } from './overmindmc.js';
const from = fleet.agents.get('Henry');
const to = fleet.agents.get('Ivy');
console.log(previewInteraction({ from, to, kind: 'give', item: 'birch_log' }));
const report = await runInteraction({ from, to, peers: fleet.peers, kind: 'give', item: 'birch_log', count: 1 });
```

Two run-in clients are needed for the meeting, who observe each other and are in the same dimension. Pre-screen does not move agents. The positions available to both sides are met, Draws them close and looks forward to a common vision, confirmed **turn, received by another client**. Then `give` Throws out the object and checks the rebound, both instruments and re-view. `meet` Only meets.

Journal `report.journal` Shows the preparation, arrival, look, Transfer and result. `partial` means, I'm sure the object left the sender, But all confirmations are not complete. Repeat not automatically executed. It's a transmission through a game object on the ground, not atomic exchange: Third player can intervene. Comparison of inventory and selection events does not prove the origin of each unit of the same object. Co-operation packages go off the game chat.

## Checks in Your World

```powershell
npm.cmd test
node examples/interaction-live.js meet
node examples/interaction-live.js gather-give
node examples/interaction-live.js retaliation
$env:MC_USERNAME = 'Henry'
node examples/storage-live.js
```

`retaliation` — limited PvP-Test of two healthy agents without a weapon: The first confirmed strike must go unanswered, The second is expected to be responded to. `storage-live` Searching for the nearest container in the cups received; Put the objects in there and make it accessible. `gather-give` First, picks up the log by class, Then he tries to pass it on. These examples change the test world by normal game action; `npm.cmd test` only run automatic tests without entering the server. Reports maintained `data/`.
