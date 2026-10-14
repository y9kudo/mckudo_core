# Connect OvermindMC to OMConnect

**Two separate libraries · The author y9kudo · MIT**

OMConnect is in [packages/omconnect](../packages/omconnect/README.md). It connects to the server, Keeps the observed state and performs the actions. OvermindMC Keeps Knowledge of the Game, Resource levels, plans and experiences. The application connects libraries via adapter. New opportunities 0.7-dev: [OMVectorize, Microsoft Auth and extension of the kernel](V0.7-DEVELOPMENT.md).

## Simple application

After local installation of both libraries:

```js
import { createOMConnect } from 'omconnect';
import { createCore } from 'overmindmc';
import { createOMAdapter } from 'overmindmc/adapters/omconnect';

const client = createOMConnect({ username: 'Alice', auth: 'offline', version: '1.21.1' });
let core, adapter;
try {
  await client.connect();
  adapter = createOMAdapter(client, { trackedBlocks: ['#logs'], searchRadius: 64 });
  core = createCore({
    config: {
      schemaVersion: 4, name: 'Alice', worldId: 'my-server',
      actionTimeoutMs: 60000,
      rules: [{ id: 'wood', action: { skill: 'gather', args: { block: '#logs', count: 1 } } }]
    },
    adapter
  });
  console.log(await core.tick()); // One step
} finally {
  await core?.stop();
  adapter?.dispose();
  await client.close();
}
```

`core.start()` start the continuous cycle. In such an application, process the process stop and call `core.stop()`/`client.close()` at completion. For a group, create `createFleet({ count: 2 })` and one adapter each/Core client.

Imports `overmindmc/connect` retained for compatibility: He exports the same single customer. Package itself `kudoconnect` does not import OvermindMC. It is installed separately from its archives; publications in npm Not yet.

## Where knowledge is found

| OvermindMC | OMConnect |
| --- | --- |
| Objectives, Planner, rules and adaptive scenarios | Session, Packages, action and cancellation |
| Complete catalogue of a specific version and classes of material | Cup received, Blocks, and equipment |
| Resource chains, instruments, Stations and fuel | Realization of only the declared skills |
| Tactical reactions and experiences | Physics, server trajectory and validation |
| Decision on joint work | Exchange of messages and intentions outside the chat room |

The brain doesn't suggest, I'm sure every client can do everything: `adapter.describe().skills` Shows available performers. Catalogue may know the furnace recipe, Even if the specific adapter hasn't done the work with her window yet. Craft scripts/potions/The relevant perpetrators require full passage; independent OMConnect Still expanding.

## Observation and classes

OMConnect publishes its own contract `omconnect.agent` v1. Adaptation converts it into observation OvermindMC, Supplements zero quantities of known equipment and retains unknown blocks as unknown. The default search distance 128, Sets to 512 blocks; the result is limited to the cups, The ones that sent the server.

Classes OvermindMC are transferred to the client register for selected `trackedBlocks`. For self-standing OMConnect Basic available `#logs`, `#leaves`, `#tree`, `#ores`, `#deepslate_ores`, `#crops`, `#workstations`; additional classes register the application.

## Verification and further development

The Repository: `npm.cmd run check`. Individual client tests: Go to `packages/omconnect` and do it `npm.cmd test`. Game group: `node packages/omconnect/examples/team.js`; variable `MC_AGENTS` it's a problem 1–20 Clients. This example only observes and exchanges data.

B Java 1.21.1 Confirmed entry, traffic, Mining/Selection and simultaneous work of seven new clients. Full pass, Expanded physics and shooting in the real world is not yet confirmed. Network prescription reading corrected; Relevant results — in [Report 0.5.0](TESTING-05.md).

[API client](../packages/omconnect/docs/API.md) · [Physics](../packages/omconnect/docs/PHYSICS.md) · [Training and adaptation](ADAPTIVE.md) · [Scenarios](SCENARIOS.md) · [Results](TESTING-05.md)

## Supplements 0.5.0

[The Ready Survival Cycle, craft, and exchange of](NATIVE-SURVIVAL.md) · [Web-Panel](DASHBOARD.md).
