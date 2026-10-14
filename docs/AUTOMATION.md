# Automation modules OvermindMC 0.4

OvermindMC — Library Minecraft. All specified functions are imported from `mckudo`; Game adapter imported from `mckudo/adapters/mineflayer`. The application is owned by the client and the connection. The core code takes data and selects actions. Author: y9kudo, MIT.

## Catalogue and recipes

`catalogFromMinecraftData(data, options)` Imports a specific version of the registry. `data` — result `minecraftData('1.21.1')` or `bot.registry`. Use it for fashion data `createCatalog({ version, items, blocks, recipes })` with ID `namespace:name`.

| Method Catalog | Result |
|---|---|
| `item(id)`, `block(id)`, `recipe(id)` | Recording or `null` |
| `recipesFor(item)` | All recipes with this result |
| `items()`, `blocks()`, `recipes()` | Copies of records |
| `summary()` | Version, quantity and distribution of types |

Numerical ID are only relevant to their version; for configuration use string namespace ID. Changing Returned Record Doesn't Change Catalog.

`readJavaDataArchive(path)` Reads JSON-and tags from JAR Minecraft or ZIP datapack. Paths supported `recipe`/`recipes`, `tags/item`/`tags/items`, `tags/block`/`tags/blocks`. Returned `{ recipes, tags, blockTags }`. Then pass it on `vanillaRecipes: recipes, tags` to the catalog importer, a `blockTags` — to taxonomy. Reading is limited 128 MiB archives, 2 MiB on record and 64 MiB unpacked JSON; ZIP64 Not accepted. Files are not retrieved from the archive and are not executed.

This is the import of one data set. For datapack Change first to create final registers and server download tags: function does not simulate server priorities datapack. The transferred register should contain the items used.

Normalized prescription format:

```json
{
  "id": "minecraft:iron_ingot_from_smelting_raw_iron",
  "type": "minecraft:smelting",
  "output": { "item": "minecraft:iron_ingot", "count": 1 },
  "ingredients": [{ "choices": ["minecraft:raw_iron"], "count": 1 }],
  "station": "minecraft:furnace",
  "executable": true,
  "reason": ""
}
```

`choices` — Acceptable Alternatives to the Intended. Imports reveal the input tags, Finds cycles and stores `raw` for special recipes. `executable` means the model of the recipe type is available to the planner; It's not a confirmation of the game test of every record. Dynamic recipes, grasshopper templates, stoner and fire are indexed with `executable: false` and explanation. Extension can use `raw` for his skill.

Executors 0.4: shaped/shapeless-craft, `smelting`, `smoking`, `blasting`. Before each operation, adapter checks ingredients, Station availability and actual output. Craft with returned containers in data `minecraft-data` separately marked as requiring accounting for balances.

## Multiple classes of blocks

```js
const classes = createBlockTaxonomy(catalog, {
  tags: blockTags,
  classes: {
    copper_source: {
      members: ['minecraft:copper_ore', 'minecraft:deepslate_copper_ore'],
      parents: ['metal_source']
    }
  }
});
classes.classesOf('minecraft:acacia_leaves');
classes.members('tree');
classes.has('minecraft:deepslate_iron_ore', 'ores');
classes.select({ all: ['tree'], none: ['leaves', 'saplings'] });
```

One block has several tags; parents inherit. `logs → tree, wood`, `leaves → tree, vegetation`, `deepslate_ores → ores → mineral`. Soil classes are provided, Stone, Construction blocks, Cultural, Stations, Containers, liquids, Risks, rails and redstones. Each block hits `all` and class of known shape: `solid`, `non_solid` either `shape_unknown`. This is the basic coverage of the entire roster; subject classification extended by tags and `classes`.

Themes are imported as `tag:minecraft:name`. Automatic names — Efficacy start-up rules. For the fashion pack blocks, send out clear classes and server tags. Class `non_solid` does not mean the safety of passage: navigation checks the support, Free cells and hazards separately.

`resourceSources(catalog, { availableBlocks, taxonomy })` Builds conservative wood sources, stones and ores from observed blocks. The usual and deep iron ore gives `raw_iron`. Tools from the roster are taken into account. The exit takes as a basic minimum without Fortune/Silk Touch; random foliage is not used as a guaranteed source. For your blocks you can transfer `sources` manual.

## Resource planning

`planResources({ catalog, targets, inventory, sources, stations, fuel, maxDepth, maxNodes, maxActions })` Builds a chain back from the result, Reserves ingredients and results already requested. The bad branch is rolling back. The plan selects the first acceptable chain found in the budget.

```js
const plan = planResources({
  catalog,
  targets: { 'minecraft:iron_pickaxe': 1 },
  inventory: observed.inventory,
  sources: resourceSources(catalog, { availableBlocks: foundBlockIds }),
  stations: {
    'minecraft:crafting_table': true,
    'minecraft:furnace': { x: 12, y: 64, z: 15 }
  }
});
```

`true` The following is the view of the installed station:. The coordinates allow the kernel to make the station and place it in the specified free cell. The adapter rechecks the location before installation. The fuel is selected by default from the board available; The capacity is considered conservatively as one item per board. You can clearly ask `{ item: 'minecraft:coal', itemsPerFuel: 8 }`.

The plan contains `status`, `reason`, `actions`, `visited`, and in success — calculated `inventoryAfter` and `stations`. The calculation values do not replace observation. Source does not guarantee, I think there's enough blocks in the world or the tool won't break; After action needs up-to-date data.

The default limits: depth 24, knots 3000, Action 256. One batch of craft — to 16 Repeats, Clothes — to 64 items. The big task of production divide into lots. `resourceWorkflow(id, plan)` converts to 64 to the task of post-sentencing.

Use this to select the result class `planResourceClasses({ ...options, targets: { '#planks': 8 } })`. One achievable view of the boards is selected; selected exact ID Returned to `resolvedTargets`. It's not a summation of a mixed pile of different types. The default shall be checked before 64 of alternatives, maximum 256.

`createResourceReactor` plans again after each action. He takes from the known springs `world.nearbyBlocks`, takes into account the installed station and selects the first action. With connection `exploration` and lack of a resource chain selects a new observation point. Use successive achievable steps — First tools, Then production of more demanding materials.

## The perception and download of the world

| Parameter Mineflayer-adapter | By default | Range |
|---|---:|---:|
| `searchRadius` | 128 blocks | 16–512 |
| `entityRadius` | 128 blocks | 16–512 |
| `requestedViewDistance` | 16 chunks | 2–32 |
| `scanIntervalMs` | 1000 ms | 100–60000 |
| `trackedBlocks` | `#logs`, `#ores`, `#workstations`, `#crops` | to 128 ID/classes, 2048 Types of disclosure |
| `watchedPositions` | `[]` | to 2048 Building cells |

Ready JSON: [perception.json](../examples/perception.json). The settings are transferred by a second argument `createMineflayerAdapter`, separate from JSON Regulations of the kernel.

Adaptation sends a client range request via `setSettings`. The server determines the actual number of chocolates, and the distance of transmission of entities. Search radius does not generate data on unladen areas. The high radius increases the time of the walk and the consumption of client memory.

One picture contains before 512 selected clusters with separate budgets for groups and prior to 128 of the nearest entities. Cash is dropped when blocks change/chunks, and conclusion of the transition. `true` in `nearbyBlocks` — Block found; `null` in bag scan — Type not confirmed by current sample. `sampledBlocks` contains the location of the find, `crops` — known cultures and maturity. For urgent reactions `observeThreats` Reads the essence and the damage without re-circling the blocks.

## Navigation and research

`planRoute` — limited A* priority over observed clusters. Upper — Position of the legs on the support. Transition: Walking in four directions, rise up on one block, descending to three blocks, permitted extraction and installation of bridge support. Bridge and mining are more expensive than normal steps. Example: [navigation.js](../examples/navigation.js).

```js
const route = planRoute({
  start: { x: 0, y: 64, z: 0 },
  goal: { x: 20, y: 64, z: 8 },
  getBlock: position => myWorld.getBlock(position),
  maxDistance: 128,
  maxNodes: 12000,
  bridgeBudget: 16,
  bridgeBlock: 'minecraft:cobblestone',
  canDig: (block, position) => myPolicy.mayMine(block, position)
});
```

`getBlock` Returns block from `name`/`id`, `boundingBox`, where available `shapes`, `diggable`, `hardness`; Unladen Cell — `null`. Free legs and head checked, support, vertical passage. Liquids and listed dangerous blocks are not considered as support. Reliance is prohibited; Authorized mining is rejected near unknown neighbors, Liquids and falling blocks. Cost is taken into account for hardness. Result: `steps`, `cost`, `bridgeUsed`, `visited`, `unknown` and the reason for the stop.

Skill `navigate` Mineflayer-adapter runs the route by its own controller OvermindMC: turn, Move keys, Jump, Production and installation of the block. He checks out the next segment on the fresh world and stops when it changes, No progress or withdrawal. The bridge needs real full-scale sustainable equipment and a nearby support. Once installed, the server shall confirm the new block; Only then is the next step allowed.

```json
{
  "skill": "navigate",
  "args": {
    "x": 20, "y": 64, "z": 8,
    "bridgeBudget": 16,
    "bridgeBlock": "minecraft:cobblestone",
    "digBlocks": ["minecraft:stone", "minecraft:deepslate"]
  }
}
```

`navigate` uses OvermindMC; old `goto` and approach to facilities in skills `gather`, `craft`, `place`, `smelt`, `harvest`, `attack` using the connection mineflayer-pathfinder. The perpetrator `navigate` Full-bed and free air cells. Swimming, stairs, Opening doors, complex forms of conflict and inter-dimensional transitions require separate transitions and actors.

`planExploration({ position, getBlock, mode, visited, radius })` Selects an achievable known point, The scope of monitoring can be expanded. Mode `ores` gives priority to lower accessible surface and depth; He's looking for passageways through known geometry. `surface` Looking for new surface areas. No regime implies the existence of a hidden ore. Radio 32 default, 4–128; to 16 candidates and 1500 Node for candidate. Use a clear policy of authorized mining in the mine `planRoute`.

## Reactor and rapid reactions

The module has `{ id, apiVersion: 1, preempt?, react(observation) }`. Synchronous `react` Returns `{ action, priority, reason }` either `{ action: null, reason }`. You can't do games inside `react`: their life cycle is controlled by the kernel. Maximum 16 modules, Unique ID. With the same priority Reactor considered earlier JSON-rules.

`createDefenseReactor` has priority 1000 and `preempt: true`. The kernel checks such reactions during operation at intervals `preemptionMs` (100 default ms, 50–2000). If threatened, cancels the current action, Waiting for him to stop, Then takes a new decision. Skills not being performed in parallel. Cancelled Step Workflow Doesn't waste an attempt. The verification interval is not a guarantee of network delay, Equipment or completion of current craft transaction.

The defense uses confirmed hostile species and a attributable source of damage. In poor health or near the cryper, selected `flee`. The player needs `attackPlayers: true`, number of strokes per window and absence from `trustedPlayers`. By default two strokes per 10 seconds, Health of derogation 8, Threat radius 8, Prosecution 12. The range of combat is limited 32. Impact source, The server did not report, Not assigned to the nearest player.

Weapons are selected before they get close: accessible sword or axe by level of material. One `attack` One strike waiting for recovery; The next solution checks the new target. Threats can disrupt food production and resource search. Annex includes the appropriate PvP-policy.

## Food, Farms and ovens

`createFoodReactor({ catalog, foodThreshold: 16, allowHunting: false, huntRadius: 16, replant: true })` has priority 900. Order: Cooked safe food → preparation of supplies → mature culture → authorized hunting. Cheese chicken, Rotten flesh and poisonous objects are not selected as ready food.

Supported by mature wheat, Carrots, Potatoes and beet. The ripeness is rechecked at the block. `harvest` Waiting for harvest, then, `replant: true` Plants suitable seeds into the remaining area. If no landing is possible, action reports, I'm sure the harvest has been harvested, But the landing was not completed.

Hunting turns on through `allowHunting: true`. The cow is coming out, Pig, chicken, sheep or rabbit; Players excluded. If adapter reports `named` or `isBaby`, such objectives are excluded. Mineflayer-adapter does not normalize these two flags for all protocols; an application can expand surveillance or leave hunting off. When the target disappears after the impact, the performer approaches the location for the dart selection. The result of the feed is determined by fresh equipment.

`smelt` accepts `input`, `item`, `count`, `fuel`, `fuelCount`, `station` (`minecraft:furnace`, `minecraft:smoker`, `minecraft:blast_furnace`). Numbers 1–64. The perpetrator opens an empty station, - It's raw and fuel, Waiting for the real exit and closing the window. He doesn't use a busy furnace. If the items already in hand are cancelled, they may stay inside; their return/Recovery belongs to the application policy. For long bathing, give me enough `actionTimeoutMs` (to 300000 ms) and size of lot.

## Construction and development

`createShelterBlueprint` Creates the floor, Walls, roof, and a two-block door. Parameters: `origin`, `width`/`depth` 3–11, `height` 3–5, `material`, `door`. `billOfMaterials` considers objects; the top of the door is not considered as the second door. `validateBlueprint` Checks coordinates and intersections.

`planConstruction(blueprint, { blocks, inventory })` compares the drawing to the picture of the cells `"x,y,z" → namespace:id`. Status: `blocked`, `needs-materials`, `ready`, `completed`. Fields `shortages` and `materials` Helps transfer missing resources to the planner. The occupied and unknown cells are not automatically cleaned. `createConstructionReactor` Selects the next missing block. Drawing cells to adapter in `watchedPositions`; The area and access to its edges selects the application.

`createSurvivalProgression` Monitors the orderly milestones and stores `{ completed }`. Standard steps: crafting table → wooden pick → Rock and furnace → Iron pick. Phase conditions can be replaced. The standard condition for the versta is for equipment; Call `update` after the craft before installation or set the condition of the installed station. This module tracks progress; Actions Select Resource Reactor, Planner or Workflow.

## Where Implementation is

| File | Responsibility |
|---|---|
| `src/catalog.js`, `src/java-data.js` | Data import and indexing |
| `src/taxonomy.js` | Classes, strategies and sources of resources |
| `src/resources.js` | Reciprocies, Alternatives, Reserve |
| `src/navigation.js`, `src/exploration.js` | Routes and research |
| `src/survival.js`, `src/food.js` | Vlaxes, Protection and nutrition |
| `src/construction.js` | Drawings and construction plan |
| `src/core.js` | Choice of action, cancellation, Observation and history |
| `adapters/mineflayer*.js` | Communications Minecraft API and enforcement |
| `overmindmc.d.ts` | Public types of library |

For Forge/NeoForge/Fabric adapter transfers its registers, Observation and skills; Basic algorithms use common contract. Specific game integration and compatibility shall be checked in the selected version: [MODS.md](MODS.md).
