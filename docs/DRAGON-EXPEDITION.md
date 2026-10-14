# Expedition from empty equipment to dragon

OvermindMC Takes decisions on resources, routes and combat. OMConnect Performs actions on the server and confirms them with packages of peace and equipment. The startup example connects these libraries and saves the report; The lift and fight algorithms are in the core.

## Start to PowerShell

Open the terminal in the folder `mckudo_core`. Requires Node.js 22+ and a local server launched Java 1.21.1 with offline-Incoming.

```powershell
npm.cmd install
npm.cmd run test:dragon:check
$env:MC_HOST = '127.0.0.1'
$env:MC_PORT = '25565'
$env:MC_NAME = 'DragonRunner01'
$env:MC_TEST_MINUTES = '120'
npm.cmd run test:live:dragon
```

`--check` checks configuration only. Use a new English name to test from zero: Start with objects or armor on will be rejected. The old name keeps the player's data on the server. Don't give the agent the resources by team and don't throw the objects: such a launch no longer checks whether it's self-receiving from zero.

Report maintained in `data/dragon-expedition.json`. It contains initial and current equipment, Coordinate actions, Errors, Combat phases and events. `MC_REPORT` Changes the way; parent folder must exist. `MC_TEST_MINUTES` sets the budget 1–480 minutes. Ctrl+C stops launch. Return with code 1 and `incomplete` means, that the objective is not achieved, Not successful passing.

## What checks the target

The sequence sets `dragonExpeditionScenario()`: Stone tools and furnace → iron → Diamond kirk and portal materials → Armoured, shield, Onions, arrows, Blocks → Neser and the knuckle of the fritts → Pearls and Ender's Eyes → Searching for a fortress on eye flight → Activation of existing frameworks → entrance End → Fight.

Portal framework in End No crafting: The agent must find the fortress and fill its frame. The script doesn't use `/give`, `/locate`, `/teleport`, seed or the world files.

`goalAchieved: true` requires completion of the scenario, presence in the End, A server confirmation of the dragon's death and confirmed damage to that agent. Direct attack, The portal found or the dragon missing is not enough. Players, Scored by, recorded in `playersObserved`; The absence of names there is also not proof of the complete isolation of the world.

## Rise and roll

```js
await client.execute({ skill: 'pillar', args: { count: 3, block: 'dirt' } });
await client.execute({ skill: 'descendPillar', args: { count: 3 } });
```

`pillar` equalizes agent in the center of the support, He jumps in the usual physics and puts the block up only after the feet rise above the top of the top. Every step is waiting for the block in the world, Item and landing consumption. `count` — from 1 to 8; without `block` Low-cost, normal complete blocks. Sand, gravel, Stations and valuable blocks are not spent. You need more health 8 and free space above the head. Change of measurement, The entry correction or cancellation shall cease to apply.

`descendPillar` only handles blocks, installed by this copy of the client and confirmed by the server. Each descent is limited to one block with a known support from the bottom. No memory of the pillars after reconnect. Normal `dig` Under-still doesn't destroy the support under the agent.

The separate verification itself produces three blocks of land, Comes up and goes down:

```powershell
$env:MC_NAME = 'PillarRunner01'
npm.cmd run test:live:pillar
```

## Decisions in End

`createDragonPolicy({ client })` Checks ballistics trajectory, Priority of crystals, Respiratory clouds and dragon phases. For a grid, a accessible area with a spare block and a free vertical column is sought. Agent climbs one block, Opens the adjacent bars and removes his pole before firing. `maxTowerHeight` Limiting the plan for climbing: default 48, Acceptable 1–64.

Crystal shot prohibited closer 12 blocks; It's a minimum policy distance, Not a guarantee of the safety of any explosion. The turning towards the ballistic direction is smooth. During the sitting dragon phase, the arrows are kept until the takeoff. A single head of a sitting dragon has not yet been hit.

`client.endgame` contains the confirmation of crystals — Explosion and removal of the substance, in place and time — and the death of the dragon. Total death and agent participation. If the package is not decoded, the execution stops.

## Connectivity from its application

```js
import { createOMConnect } from 'overmindmc/connect';
import { createEndExpedition, dragonExpeditionScenario } from 'overmindmc';

const client = createOMConnect({ username: 'DragonRunner02', auth: 'offline' });
await client.connect();
const expedition = createEndExpedition({
  client,
  worldId: 'my-test-world',
  scenario: dragonExpeditionScenario()
});
await expedition.brain.start();
// At the end of the application: await expedition.brain.stop(); await client.close();
```

The profile captures the logs from the available wood options, Takes into account failed approaches, Gather ingredients before returning to the station and search for the nearest observed wire and feathers mobs. Everything is checked by actual inventory; Source table doesn't promise guaranteed drip from each bub.

## Results and limits of verification

On the local server 1.21.1 A self-renewed land collection, climbing three blocks and breaking the pole: Health 20/20, No position correction. Automatic checks cover the grate separately, pole plan, obstacles, Rescission and confirmation of victory.

You can ask for a separate reconnect to a character already playing `$env:MC_RESUME='1'` and the former `MC_NAME`. Report notes `resumed:true` and stores actual start-up equipment; Such a test does not in itself prove a passing from zero. Normal launch on-still requires a new character with empty equipment and no armor. Use the new one `MC_REPORT`, To keep the reports from previous attempts.

The mission's resource area is shared CPU worker Research. The controller memorizes the monitored measurement portals: Checks the active unit when returned, and to the area that is unloaded goes through confirmed research points. The old coordinates per se do not allow entry into the portal.

Full passage from zero and dragon murder is not yet confirmed. Algorithms End The test shall be performed separately on the actual towers and dragons; A successful model or a ready scenario does not replace such a run. Long passage also depends on the receipt of osidian near liquids, Looking for a Neser fortress and a safe transition between regions of the world.

Description of phases for Java 1.21.1: [Yarn PhaseType](https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/net/minecraft/entity/boss/dragon/phase/PhaseType.html). server message formats: [minecraft-data protocol 1.21.1](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.21.1/protocol.json).
