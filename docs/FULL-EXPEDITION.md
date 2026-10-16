# Running an expedition

OvermindMC supplies `fullExpeditionScenario()` and `createEndExpedition()` as reusable library APIs. OMConnect executes the actions; the application owns its connection, runtime, storage and shutdown. Created by **y9kudo**.

## Start an application

Use Node.js 22.13 or later and a compatible Minecraft Java server. The current native gameplay profile is Java 1.21/1.21.1. Start with a fresh Survival player in the Overworld.

```powershell
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_VERSION='1.21.1'
$env:MC_NAME='ArthasAgent'
$env:MC_WORLD_ID='my-survival-world'
$env:MC_REPORT='data/expedition/report.json'
npm.cmd run expedition:check
npm.cmd run expedition:full
```

`examples/expedition.js` is an application example, not a second implementation of the agent's intelligence. It requires an empty inventory/equipment and rejects Creative mode. Decisions and crafting dependencies live in the libraries. Press Ctrl+C to stop it. This minimal example does not restore scenario memory or respawn after death; applications can implement recovery using the controller's `exportMemory()` and `checkpoint` option.

## View progress

In a second terminal, retain the same `MC_REPORT` value:

```powershell
$env:MC_REPORT='data/expedition/report.json'
$env:MC_DASHBOARD_PORT='4181'
npm.cmd run expedition:monitor
```

Open **http://127.0.0.1:4181**. The page shows stage progress, current action, health, position, inventory, recent outcomes and available computation/learning counters. It reads one local report; it does not log in another bot. A stale badge warns when the producer's heartbeat has stopped. The visual agent editor remains available through `npm.cmd run dashboard`.

## Campaign structure

The library profile prepares wood and stone tools, a shield and iron equipment, returns toward its observed starting area to build shelter, obtains portal and combat supplies, visits the Nether, gathers blaze rods/pearls, crafts Eyes of Ender, searches for the stronghold, enters the End and fights the dragon. The live world determines whether each stage can progress.

The current profile includes concrete supply choices and does not prove that every seed, biome, dimension transition or combat encounter is solved. Review and adapt it for your application. Read [planning layers](PLANNING.md), [public API](API.md), [scenario format](SCENARIOS.md) and [quality policy](QUALITY.md).

Detailed QA drivers and personal journals are kept outside public product examples. An application reaching a stage or a planned attack is not sufficient to declare a complete game victory.
