# Nether progression

OvermindMC owns goals and decisions; OMConnect executes actions and confirms their outcomes. This profile targets Minecraft Java 1.21.1. Author: **y9kudo**, MIT.

## Reusable progression profile

`netherVisitScenario()` supplies a reusable library profile. Pass it to `createEndExpedition({client,worldId,scenario})` after connecting a fresh Survival player. Applications own the runtime, cancellation, persistence and shutdown; [the expedition example](FULL-EXPEDITION.md) illustrates those responsibilities. The profile's stages are:

1. Gather available logs by class and craft a table, stone tools and a furnace.
2. Prepare a shield, iron tools and an iron chestplate.
3. Obtain golden boots and spare construction blocks.
4. Acquire a diamond pickaxe, 14 obsidian and flint and steel.
5. Build and ignite a full 4 by 5 portal frame, then enter it.
6. Collect eight netherrack and four quartz, and reach at least 12 horizontal blocks from the Nether objective's starting position using observed terrain.

The current construction profile uses mined obsidian. It does not replace that prerequisite with a bucket-cast frame. Resource acquisition and finding a suitable supported construction area can be lengthy or fail; a configured profile is not proof of a successful run.

Keep operational reports and checkpoints under an ignored runtime directory. The [local progress monitor](FULL-EXPEDITION.md) can read an application's report without connecting another agent. Detailed gameplay QA drivers are not part of the public package.

## Use the domain in an application

```js
import {createMinecraftAgent} from 'overmindmc';

const agent = createMinecraftAgent({
  name: 'Atlas', worldId: 'my-world',
  connection: {host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline'}
});
try {
  // This objective requires the agent to be in the Nether already.
  await agent.run({
    schemaVersion: 1, name: 'Explore the Nether',
    steps: [{id: 'explore', type: 'netherResources',
      targets: {'minecraft:quartz': 4}, exploreDistance: 12}]
  }, {timeoutMs: 600000});
} finally {
  await agent.close();
}
```

`createNetherReactor` accepts item targets and an optional `exploreDistance` from 0 to 128 blocks. Zero retains inventory-only completion. A positive distance requires both inventory targets and an observed horizontal displacement from the objective's origin. The origin and maximum displacement persist in exported memory; restarting does not reset the distance requirement to the agent's new position. Low health suspends exploration. Paths use known terrain, ordinary navigation and bounded search.

## Existing policies

| Area | Behavior |
| --- | --- |
| Movement | Walk observed routes; try bounded dry passages and short bridges when their support and material constraints permit |
| Environment | Avoid known lava hazards; do not use water-based protection or sleep in the Nether |
| Piglins | Keep a gold armor piece; barter only with eligible observed adults; count actual collected rewards |
| Resource mobs | Approach or fight observed targets, use ranged opportunities when supported, and confirm loot in inventory |
| Landmarks | Remember observed fortress-like blocks, portal cells and warped vegetation; blocks are evidence, not hidden structure coordinates |
| Materials | Reuse connected-version resource classes, recipes, workstations and tool requirements |

`netherCapabilities(registry)` lists domain groups for the connected registry. Custom mod machines require their own registered executors. Potion planning is available separately; a recipe graph alone does not establish autonomous brewing execution. Completion of a Nether objective does not establish full Dragon completion. See [the quality policy](QUALITY.md).
