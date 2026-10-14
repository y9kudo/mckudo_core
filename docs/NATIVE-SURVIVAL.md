# Survival OvermindMC + OMConnect

Author: **y9kudo**. OvermindMC Chooses the goal and next step; OMConnect connected to Minecraft, Gets peace and does things. Test Profile — **Java 1.21.1, offline**. You don't need a pay I.I. or Mineflayer.

## First agent

In the terminal VS Code Open the root `mckudo_core`, Set Dependency through `npm.cmd install`. Create next to `overmindmc.js` File `my-agent.js`:

```js
import { createOMConnect } from './omconnect/index.js';
import { createMinecraftBrain } from './overmindmc.js';

const client = createOMConnect({
  username: 'Oliver', host: '127.0.0.1', port: 25565,
  version: '1.21.1', auth: 'offline'
});
await client.connect();
if (client.state.status === 'dead') await client.respawn();
const brain = createMinecraftBrain({
  client, worldId: 'my-local-world',
  survival: { target: 'stone_tools' },
  storage: { radius: 16, maxStacks: 54 },
  defense: { retaliationHits: 2 },
  config: { actionTimeoutMs: 60000 }
});
brain.on('action:finish', result => console.log(result));
brain.start();
process.once('SIGINT', async () => {
  await brain.stop();
  await client.close();
});
```

Run `node my-agent.js`. `username` — player's name on the server. `worldId` — your world's permanent name for the core, Not the connection address. `target` — result, to which the library is seeking. External program starts cycle, but doesn't contain any recipes, of obstacles or decisions to exploit.

If you use separate packages, imports will `kudoconnect` and `mckudo`. Packages not yet published npm; [local installation instruction](../packages/omconnect/README.md).

## Objectives and monitoring of results

| `target` | Readiness condition |
| --- | --- |
| `wood` | Versac in inventory |
| `stone_tools` | Stone kirk and stove in inventory |
| `iron_pickaxe` | Iron pick in inventory |
| `diamond_set` | The helmet, breast plate, ♪ Beautiful ♪, Shoes, Kirk, A sword and an axe of diamonds |

The latter requires 32 Diamond on agent. Items checked, confirmed by the server, including four slots of armor. `createEquipmentReactor` automatically wears an accessible armor, Prefering to a higher level of material. Enchanting and strength are not yet involved in comparison of armor. `inventory.count()` Considers objects carried over; `inventory.ownedCount()` also takes into account the. `inventory.equipment()` Returns `head`, `chest`, `legs`, `feet`.

`brain.survival.snapshot()` contains `status`, `stage`, `reason`, `targets`, `remaining`, `completed`, `knownResources`, `lastFailure`. `completed` — History of the intermediate stages achieved; Current ownership, check through `client.inventory.snapshot()`. For your ultimate purpose, pass `survival.targets: { 'minecraft:iron_pickaxe': 1, 'minecraft:iron_axe': 1 }`.

Wood is chosen from accessible sources and the cost of recipes. Different boards are suitable for the verstack, But the recipe for a birch door cannot be automatically replaced by oak boards. The deep-slurpedo is seen as a source of the same useful resource, with test of the cirque level.

The core memorizes observed resources, Seeks open approaches and puts a ladder down if necessary. It checks the support, Liquids, The falling blocs and the lower limit of the world. No access route recorded as the reason for the stop/Replanning. The model does not yet guarantee the passage of any random map.

## Craft and workstations

Direct action is required for manual control or for own Reactor. Stop the automatic brain before the manual command: `await brain.pause()`.

```js
await client.execute({ skill: 'gather', args: { block: '#logs', count: 1 } });
await client.execute({ skill: 'craft', args: { item: 'acacia_planks', count: 4 } });
await client.execute({ skill: 'craft', args: { item: 'crafting_table', count: 1 } });
await client.execute({ skill: 'ensureStation', args: { station: 'crafting_table' } });
await client.execute({ skill: 'ensureStation', args: { station: 'furnace' } });
```

`craft.count` — How many **new** items to be produced. The recipe can round up the number: The five logboards will give you eight. 2×2 uses equipment, 3×3 — crafting table. The server response is expected for each click; The ingredients and empty italics shall be checked after the result has been obtained.

`ensureStation` Looking for an accessible station. If she's not here, Creates and sets up his own. Prix `gather: true` (default) Collects missing basic materials; `gather: false` only authorizes current stocks. Supported by the wind and the common furnace. Other stations should not be considered available for the sole reason, I'm sure they're in the catalogue.

```js
await client.execute({ skill: 'smelt', args: {
  item: 'iron_ingot', input: 'raw_iron', count: 2, fuel: 'coal'
}}, { signal: AbortSignal.timeout(45000) });
```

Raw and fuel must be in the inventory. The usual bathing suit takes 200 game tikis for the. The perpetrator shall take away the confirmed result and the remaining unburned fuel. No other person's objects are automatically consumed by the furnace. Agents in one trial are waiting for the release of the occupied furnace. The cheese can stay in the world when the cliff is broken — Operation isn't rolling back.

Static recipes are taken from data 1.21.1; Non-supported special and return-of-containers prescriptions are rejected. `craftingRecipes` and `chooseCraftingRecipe` allow for pre-screening. The recipe catalogue is larger than the current set of performers.

## Movement, Fight and Lute

Turn limited speed and picks a short arc. `lookAt` Sets a goal, `await waitForLook()` Waiting for her achievement. Navigation accelerates on a proven straight path and includes jumps at a sufficient distance, food reserve and free space. At the edges, When a shield and an unknown support is used, the sprint is limited.

The bridge uses existing safe, complete blocks: land, Rocket, boards, wool, concrete and other suitable materials. Falling, dangerous, Valuable and functional units protected against automatic flow. `bridgeReserve` Leaves the stock; `bridgeItemValue(name, item)` changes the selection process. `navigate.args.bridge: false` Disables bridge on a particular route. Each block is confirmed before forward movement.

`dig` Selects a tool in a block and the ability to get a throttle; `combat` — on arms, Distances, shield and re-entry. Two server events one player has lost for 10 seconds start answer. The presence of a direct strike does not prove the damage — It's different evidence in the tests.

Selecting tracks relevant entity coordinates. Missing object is not considered received: the result `gained: 0`, `serverConfirmed: false`. Reactor Re-choices available production. Crafts, Double chests, The barrels and all the colors of the shalckers are automatically sought; `maxStacks: 54` Takes everything, What is placed, for one inspection. Ender-Caches and trading with residents are not yet part of the warehouse performer.

## Three agents and exchange

```js
import { createAgentManager } from './overmindmc.js';
const team = createAgentManager({
  count: 3, names: ['Owen', 'Liam', 'Noah'], worldId: 'my-local-world'
});
for (const name of ['Owen', 'Liam', 'Noah']) {
  await team.execute(name, 'connect');
  await team.execute(name, 'start');
}
process.once('SIGINT', () => team.close());
```

Manager connects individual brains through `OMPeer`. Mining intentions and short throttle reserve transfer during, No messages Minecraft. Hand-assed pass `survival.peer: fleet.peers.get(name)` Every brain. It's a collaboration of known participants; A side player can still pick up a subject.

`itemValue` Assesses the usefulness; `survivalReserves` Protects the best brick, Target equipment, I'm on my way, Fuel and materials. `proposeTrade` Returns the sentence, Only if the exchange is beneficial to both, Or there's an extra gift item. `runTrade` Performs two physical transfers and stores separate receipts.

Manager checks on working close agents every four seconds. Normal armor, tools and bed are accounted for as current needs even for further purpose `diamond_set`. The recipient of the three sets from the chest keeps himself alone and transfers the extra sets to the participants, I'm sorry, I'm sorry. Diamonds for undeveloped targeted items remain on reserve. Both parties are suspended for the duration of the transfer, Then the automatic work resumes.

The gear location is selected away from other players and checked before the drop. Prix `partial` Automatic pair re-supplies lock before manager restarts: First, check the inventory. If the item has not yet been transferred, a temporary error postpones repetition on 30 seconds. B Minecraft No atomized exchange of discarded objects. Hand `give`/`trade` Pause the brains of the participants; After the test, call again `start`.

For your team without a manager, call `shareTeamSupplies({ clients: [...fleet.agents.values()], peers: fleet.peers })` at time, when the perpetrators are free. The function contains a policy of allocation and confirmation of transfer, Returns the magazine `transfers`; Don't start it at the same time as the same clients. `maxTransfers` Limiting work, result `pending` means the remaining proposals.

## Night and resources of animals

By default, the profile uses `night: { retryMs: 60000 }` and `hunting: { targets: { leather: 4 }, foodReserve: 6, radius: 24, prepareWool: true }`. In the ordinary world at night, the agent is looking for an accessible unoccupied bed. If there is a bed object or three blocks of wool of the same color, he can prepare it himself, Get boards and verstaq. Two cells shall be checked for setting, support and space above them.

The server must confirm the sleeping position. If night isn't gone, With limited waiting, the agent rises and continues to work. No bed/Flat or after server failure, normal tasks retained. Beds in Nether/End not used.

Hunting selects adult sightings of unnamed animals for the right resources: cows — Skin and meat, sheep — Meat and wool of their colour. Infants and animals with name excluded. Sheep after haircut are not considered to be wool. A route is being built to the far end; A failed approach is paused, I'm not gonna get caught up in it. The resource receipt confirms a separate selection, Not the actual fact of a direct impact.

`night: false`, `hunting: false`, `equipment: false` Disable relevant policies. For example, `hunting: { targets: { leather: 2 }, foodReserve: 4, prepareWool: false }` Limiting hunting to skin and small food supplies.

## ♪ The movement among players ♪

A* Considers eight directions on a level surface. For diagonal, both adjacent side cells are checked, So the agent doesn't go through the angle of the barrier. Movement takes into account observed positions of other players: Lowering speed near them, Selects a side-by-side route and rearranges the route. In the absence of safe bypass, action stops with cause. Sprint and jump depend on the level of the food, support and free space.

## How to expand the scenario

Start with the finished profile; Shut down the parts through `storage: false`, `survival: false`, `loot: false`, `needs: false`. You can add your rule through `config.rules`, a Computed behaviour — Through `reactors`. The action has `skill` and `args`; at the condition — Path to fact and comparison. Detailed examples JSON: [SCENARIOS](SCENARIOS.md) and [JSON](JSON.md). Return the decision from Reactor, Don't start parallel action there: Cancellation and priorities manage the kernel.

## Check on server

`npm.cmd run test:live:native` connects Owen, Liam, Noah and start a time-limited run. `MC_TEST_MINUTES` it's a problem 1–120 minutes, default 10. `MC_NAMES` it's three names in a decimal place. Checking written `data/native-campaign.json`: Incoming, Prescriptions, Resource levels, look, Action, Phases and final inventory. Reentry Saves server equipment; `fromZero: false` clearly notes the continuation.

`passed` is only installed when full set of all three. `incomplete` means an unfinished purpose, Not successful passing. `npm.cmd test` Runs automatic checks without connection to the game. Their result is not a substitute for a living test.
