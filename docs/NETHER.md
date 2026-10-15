# Nether progression and the fresh-spawn trial

OvermindMC owns goals and decisions; OMConnect executes actions and confirms their outcomes. This profile targets Minecraft Java 1.21.1. Author: **y9kudo**, MIT.

## Run the focused trial

Use a local offline Survival server and a new player name. Existing names can retain items, armor or a position in another dimension.

```powershell
npm.cmd run test:nether:check
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_VERSION='1.21.1'
$env:MC_NAME='ArcherNetherD3'
$env:MC_WORLD_ID='nether-trial-world-01'
$env:MC_TEST_MINUTES='30'
npm.cmd run test:live:nether
```

The check command validates configuration without connecting. The live command rejects a nonempty starting inventory, equipped armor, a non-Survival mode or a start outside the Overworld. Do not give items or teleport the agent during an unassisted trial. Set `MC_TEST_MINUTES=0` to remove the overall deadline; individual actions remain bounded.

The profile is defined by `netherVisitScenario()` in the library. Its stages are:

1. Gather available logs by class and craft a table, stone tools and a furnace.
2. Prepare a shield, iron tools and an iron chestplate.
3. Obtain golden boots and spare construction blocks.
4. Acquire a diamond pickaxe, 14 obsidian and flint and steel.
5. Build and ignite a full 4 by 5 portal frame, then enter it.
6. Collect eight netherrack and four quartz, and reach at least 12 horizontal blocks from the Nether objective's starting position using observed terrain.

The current construction profile uses mined obsidian. It does not replace that prerequisite with a bucket-cast frame. Resource acquisition and finding a suitable supported construction area can be lengthy or fail; a configured profile is not proof of a successful run.

## Inspect, stop and resume

```powershell
node examples/expedition-status.js data/nether-visit/report.json --watch
Set-Content -LiteralPath 'data/nether-visit/report.stop' -Value 'stop'
```

Reports, append-only events, learned model memory and scenario checkpoints are written under `data/nether-visit/`. These files are ignored by Git. To resume, remove the stop file, retain the same world, player and server settings, set `MC_RESUME=1`, and run the command again. By default, death ends a segment. Optional recovery uses the same controls described in the [full expedition guide](FULL-EXPEDITION.md).

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

`netherCapabilities(registry)` lists domain groups for the connected registry. Custom mod machines require their own registered executors. Potion planning is available separately; a recipe graph alone does not establish autonomous brewing execution. The [validation record](results/arthas-dev3-validation-2026-10-15.md) distinguishes unit tests and live runs. Stable Dragon-completion evidence remains separate from this shorter Nether trial.
