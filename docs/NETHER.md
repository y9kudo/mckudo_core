# Neser in OvermindMC

Author: **y9kudo**. This module is part of the library OvermindMC. Decisions are made by the kernel, a Connectivity, Packages, The self-employed perform the physics and action OMConnect. Work profile of these changes — Java 1.21.1.

## What a module does

`createNetherReactor` Gets fresh observations and picks **One next action**. Once it's done, it checks the world and the equipment again. Sent strike, Spent ducts or missing objects are not considered to have been received.

| Task | Conduct |
| --- | --- |
| Searching for Fort | Remembers the observed hell bricks, barriers, Stage, The growth and the flotte. Bricks are a search guide, Not proof of the origin of the construction. |
| Research | Using existing planners for available concessions. If there is no way, checks short dry tunnel; Doesn't dig a support under him or open known lava pockets. |
| Miss | Maybe order `bridgeTo` to the observed site through the fully known corridor 16 blocks. Fuel wood doesn't go to bridges/Nezer poles; Crimson and distorted boards allowed. |
| The Ifrites | It's a safe path, uses a simple battle with a shield; If there is an onion and arrow, it can shoot at a visible far-reaching target. The rod is counted only in the inventory. |
| Pearls | Searching for observed endermen or using limited exchange with adult piglins. The number of exchanges does not guarantee the number of pearls required. |
| Piglins | Puts on and stores one gold piece of armor. Resource policy avoids gold mining near the piglins. Brutus are not considered exchange partners. |
| Growth | Makes mature growth (`age=3`). Clearly protected by the user in the field-still operational. |
| Other materials | The overall resource planner handles the black stone, basalt, The Stone of Hell, sand/soil of the shower, Mushrooms, quartz, Gold nuns, Light, Ancient debris and the dependence of the recipes on the available version. |
| Lot Mobs | A clear target can look for magma clots, The tears of the gazing, skull of skeleton-desiccants and hoglin pork. Rare depositions are not replaced by calculated numbers. |
| Backward | Scenario controller maintains measurement portals, Rechecks blocks, can relight the entire frame being observed. |
| Water and beds | Sleep is already limited to the upper world. `waterGuard` and `waterClutch` Now banned in Neser and not selected as a protection against falling/The enderman. |

`netherCapabilities(client.registry)` Returns the item and station review **connected version**. Full recipes are in the world's book; A separate copy of Neser's recipes is not loaded. Gold nuns turn into bars on a verstack; For ancient debris, the planner requires a diamond or non-zeric brick. Selecting the height of the study — Search strategy, not knowing the hidden ore.

## Shortest scenario

For an agent, The one already in Neser:

```js
await agent.mission([
  { nether: { blaze_rod: 10, ender_pearl: 20, nether_wart: 3, soul_sand: 1 } }
], { timeoutMs: 1_800_000 });
```

`agent` created through `createMinecraftAgent`. This call doesn't teleport the player or give out the objects. Use it for a full journey [Expedition file](FULL-EXPEDITION.md).

Same action in the ordinary JSON-scenarios:

```json
{
  "schemaVersion": 1,
  "name": "Neser resources",
  "steps": [
    {
      "id": "nether-resources",
      "type": "netherResources",
      "targets": {
        "minecraft:blaze_rod": 10,
        "minecraft:ender_pearl": 20,
        "minecraft:nether_wart": 3,
        "minecraft:soul_sand": 1
      }
    },
    { "id": "return", "type": "travel", "dimension": "minecraft:overworld" }
  ]
}
```

## Integrating into your application

```js
import { createMinecraftBrain, createNetherReactor } from 'overmindmc';

const nether = createNetherReactor({
  client, // connected OMConnect
  targets: { blaze_rod: 10, ender_pearl: 20 },
  maxBarters: 64
});
const brain = createMinecraftBrain({
  client, worldId: 'my-survival-world',
  survival: false, storage: false,
  reactors: [nether]
});
let current;
brain.on('action:start', e => { current = e.id === nether.id ? e.action : null; });
brain.on('action:finish', e => {
  if (current && e.rule === nether.id) nether.recordResult(e, current);
  current = null;
});
brain.start();
```

Uh-huh `createEndExpedition` The transmission of results and the development of this module are already connected. With hand `createScenario` Please pass `netherFactory`; simple API Agent does it automatically. `snapshot()` Shows the remaining targets, benchmarks and exchange costs. `exportMemory()` Maintains orientations, Cells visited and budget; This memory should belong to the same world and agent.

## Confirmations and boundaries

`barter` in OMConnect Gives exactly one existing duct to a observed adult piglin and waits for a server change in the inventory. The missing item is not in the package: The near Lut is not declared proven. The selection and achievement of the objective shall be verified separately. Exchange does not open chest menu.

Smelting and grasshopper improvement use existing active performers. The Zeli Count describes the ingredients, shapes and fuel, but full-fledged per-cool-cup cycle/The use of potions has not yet been realized. All types of automatic farms are also not being sold, Universal looting of bastion or reconstruction of any damaged frame. The module does not declare these options operational.

Automatic checks cover solutions and model exchange protocol. **Full game tour through Nether and victory from zero has not yet been confirmed.** For issuance 1.0 Need server results from the entire chain.

Mechanically controlled [description of the piglins from Mojang](https://www.minecraft.net/en-us/article/meet-piglins) and [vanilla table exchange Java 1.21.1](https://mcasset.cloud/1.21.1/data/minecraft/loot_table/gameplay/piglin_bartering.json). Table of awards; It is not a promise of a particular exchange.
