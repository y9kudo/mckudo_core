# How to Write Scenarios OvermindMC

For the first agent, you can start with `await agent.mission([{ get: '#logs', count: 3 }, { craft: 'stone_pickaxe' }])`. It's a simple goal format with planning inside the core. Yes JSON-file and start-up command without own JavaScript: [Mission, and bridges](MISSIONS-AND-BRIDGES.md).

Ready for defence response, A selection from the chests, instruments and mutual vision are included through [Standard brain profile](BEHAVIOR.md). They don't need to be re-exaggerated in the script.

To choose alternatives after failure, For training in surveillance and harmonization of several agents see. [Experience and adaptive scenarios](ADAPTIVE.md). Self-contained client described in [OMConnect](../packages/omconnect/README.md).

Scenario describes desired actions or results. Player lives in the app, a OvermindMC Selects the next step and checks observations. I.E-Provider not required for normal scenario.

## First JSON

B JSON The names of the fields and rows are double quotations. Numbers are written without quotations. No decimal place after the last field. Comments in JSON Not allowed.

Example of one task for OMConnect:

```json
{
  "schemaVersion": 4,
  "name": "Wood collection",
  "worldId": "my-world",
  "actionTimeoutMs": 60000,
  "workflows": [{
    "id": "collect-wood",
    "steps": [{
      "id": "get-three-logs",
      "action": {
        "skill": "gather",
        "args": { "block": "#logs", "count": 3 }
      },
      "maxAttempts": 2
    }]
  }]
}
```

`name` — signature of the annex, `worldId` — The world identifier you chose. Don't use one `worldId` for different memory storage. `workflows` — List of tasks. `steps` — their steps. `skill` Chooses adapter skills, `args` transmits its parameters. `maxAttempts` limits repetitions for errors. The order and dependence are described in more detail in the [WORKFLOWS](WORKFLOWS.md).

`#logs` includes different types of stem; `minecraft:birch_log` demands the birch. `#tree` Also includes leaves and is not suitable as a synonym for wood production.

## File upload

The application and connection are to be checked in [Management OMConnect](OMCONNECT.md). Instead of built-in object `config` Read it JSON:

```js
import { readFile } from 'node:fs/promises';
import { createCore, validateConfig } from 'overmindmc';

const config = validateConfig(JSON.parse(await readFile('./wood.json', 'utf8')));
const core = createCore({ config, adapter }); // adapter created by the Annex
core.on('action:finish', result => console.log(result));
core.start();
```

When the application ends, Wait `core.stop()`, Call `adapter.dispose()` and `client.close()`. Reentry is not equal to dumping of peace or equipment.

## Objectives instead of separate pressures

There's a higher format `Scenario`, He has a separate `schemaVersion: 1`. Don't mix it with the shape of the kernel 4:

```json
{
  "schemaVersion": 1,
  "name": "First tools",
  "steps": [
    { "id": "wood", "type": "resources", "targets": { "minecraft:wooden_pickaxe": 1 } },
    { "id": "stone", "type": "resources", "targets": { "minecraft:stone_pickaxe": 1 } }
  ]
}
```

```js
import { createScenario } from 'overmindmc';
const controller = createScenario({ scenario, catalog, stations, getBlock });
const core = createCore({
  config: { schemaVersion: 4, name: 'MyApplication', worldId: 'my-world' },
  adapter,
  reactors: [controller.reactor]
});
console.log(controller.snapshot());
```

`catalog` contains data from a particular version. `stations` sets the monitored stations or the free coordinates for their installation. `getBlock(position)` returns the monitored block, or `null`; unknown blocks cannot be replaced by air. The core re-choices the current inventory and sources. The material already available is preferred to new production; The distance between sources is taken into account.

## Types of high-level steps

| `type` | Parameters |  Completion condition |
|---|---|---|
| `resources` | `targets`: ID/#Grade → Number | The items required are seen in the inventory |
| `shelter` | — | Walls built on a flat site, roof and door; materials are being produced as planned |
| `collect` | `item`, `count` | The selection is confirmed by the inventory |
| `netherPortal` | Non-binding `origin`, `axis` | All six blocks of the gap are active portals |
| `travel` | `dimension` | New measurement confirmed |
| `blazeRods` | `count` | The required number of rods received |
| `enderPearls` | `count` | The necessary amount of pearls received |
| `eyes` | `count` | Catalogue/craft has brought the number of eyes to the target |
| `stronghold` | — | Box found End-portal |
| `endPortal` | — | Active End-portal |
| `dragon` | — | The dragon's death occurred |

Summarization of steps — Planning interface. Each step requires an adapter with appropriate skills. OMConnect He's doing the mining, craft, Boiler, Construction and portal access; The successful plan is still being tested by server observations. `shelter` Builds a compact house on a flat ground already in place and doesn't tear down the occupied blocks. If site unknown or not feasible, The phase remains blocked or research continues. Substitution of adapter does not occur automatically.

Boxes End-portal in survival not created by craft: The stage looks for the existing structure and makes eyes. Triangulation estimates the area of the fortress by observed flips, But it doesn't give out hidden coordinates of the portal room.

## Examples of tests

B `examples/scenarios/` in the field `first-tools.json`, `collect-log.json`, `nether.json`, `stronghold.json`, `dragon.json`, `survival-to-dragon.json`. Last — experimental full sequence, Not the confirmed passage of any world. If no material source is available, accessible passage or operator, The stage remains blocked with cause.

For the old adapter from the repository:

```powershell
node examples/scenario-mineflayer.js examples/scenarios/first-tools.json --check
$env:MC_AUTH='offline'
node examples/scenario-mineflayer.js examples/scenarios/first-tools.json
```

For the circuit flounders, load the full catalogue via `MC_DATA_ARCHIVE` with JAR Java 1.21.1. `MC_MINUTES` Limiting time, `MC_MAX_ACTIONS` — Number of actions, `MC_REPORT` — Report file. The test stops at death, Disable, Three consecutive mistakes or budget exhaustion.

## How to Deal With Results

Sign on `action:finish` And look `outcome` and `detail`. Control status: `pending`, `running`, `blocked`, `completed`. `blocked` contains a specific reason; The increased number of attempts does not correct the lack of a tool or the inaccessible route.

B End Shots taken separately, explosion near a previously observed crystal, The disappearance of this crystal, Dragon death and confirmed agent damage. Leaving a thing out of a load is not murder. Flag `victoryVerified` In the experimental report, requires the death of a dragon, The original and original original crystals. Full autonomous passage is not yet confirmed by the game report.

The script author manages simple goals; Core developer expands performers, mechanic, Catalogues and evidence of result. Rules, Workflow and Reactor remain accessible for better management.

Complete profile without manual prescription listing: [NATIVE-SURVIVAL](NATIVE-SURVIVAL.md).
