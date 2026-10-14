# Simple API agent · OvermindMC 0.6.0

OvermindMC — Decision-making library for the Minecraft. OMConnect — Independent client, who receives a server state and performs actions. `createMinecraftAgent` The fact that they are living together in a small life cycle API. The same planners are used inside, Reactors, server memory and validation, as in the extended API.

Author: **y9kudo**, licence MIT. Examples are needed Node.js 22+ And yours offline-server Java 1.21.1. The versions of the client are listed in the [matrix](VERSIONS.md).

## First scenario

In a cloned repository, do it `npm.cmd ci`. Create a file to its root `my-agent.js`:

```js
import { createMinecraftAgent } from './overmindmc.js';

const agent = createMinecraftAgent({
  name: 'Atlas',
  worldId: 'my-survival-world',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1' },
  memoryDirectory: 'data/agents'
});

try {
  const result = await agent.mission([
    { get: '#logs', count: 2 },
    { craft: 'crafting_table' },
    { craft: 'wooden_pickaxe' }
  ], { timeoutMs: 300000 });
  console.log(result.inventory);
} catch (error) {
  console.error("The script is not complete:", error.message);
} finally {
  await agent.close();
}
```

Run `node my-agent.js`. In a separate annex with a specified package, imports change to `import { createMinecraftAgent } from 'overmindmc'`.

You can write separate goals: `await agent.get('#logs', 8)`, `await agent.craft('stone_pickaxe')` and `await agent.goTo({ x: 40, y: 64, z: -20 })`. There's a launch from the usual JSON, clues VS Code bridge preparation: [detailed guidance](MISSIONS-AND-BRIDGES.md).

`worldId` — Your chosen permanent name for peace, I don't think so IP. Keep it on the same world's restart; for a new world, give another meaning. `name` — Game client name, Latin, numbers and emphasis, to 16 characters. Offline-The entry does not require a password. `memoryDirectory` includes the maintenance of experience; without this parameter memory is working in the current process.

## What Purpose

`targets` it's a problem **Number, to be available to the agent at this stage**, Not the number of craft operations. `#logs` Consists of suitable logs of different species. The kernel chooses the raw material available, ingredients, Tools and stations. First, a tree can turn into a board, Then in the right and the right instrument. The previously completed phase does not require the continuous maintenance of its consumables.

For `resources` used `minecraft:item_name` either `#class`. For example, `minecraft:stone_pickaxe` and `minecraft:furnace`. The mechanics of complex scenarios are described in [of the scenario management](SCENARIOS.md).

`run()` connects client, replaces the sequence of the given script, ♪ start brains and wait for results ♪. It is successfully completed after validation by observations. Error of the task, Death, Disable, cancellation or time-Outwards Promise. At the end, the brain stops, Connectivity remains open. Time-default — 5 minutes, range — 1 second–30 minutes, including connection. Interrupted changes in the world do not roll back. One implemented simultaneously `run()`.

## Management

| Challenge | Result |
|---|---|
| `await agent.connect()` | Connect without starting behavior |
| `await agent.mission(steps, { timeoutMs, signal })` | Run the list of simple objectives `get`, `craft`, `go` |
| `await agent.get('#logs', 8)` | Get Resource ID or Class |
| `await agent.craft('stone_pickaxe')` | Prepare the subject and its dependence |
| `await agent.goTo({ x, y, z }, { bridge: true })` | Go to the sites, by preparing the bridge materials as required |
| `await agent.start('stone_tools')` | Run a permanent survival goal; available `wood`, `stone_tools`, `iron_pickaxe`, `diamond_set` |
| `await agent.run(scenario, { timeoutMs, signal })` | Run the result control script |
| `agent.snapshot()` | Status, equipment, objectives, Training, Space memory and metrics |
| `await agent.pause()` | Cancel the current script and stop brain action |
| `await agent.respawn()` | Stop the behavior and request the rebirth of the dead client |
| `await agent.close()` | Stop Actions, Save memory and close connection; repeat call allowed |

After `close()` Create a new agent object. Saved experience is downloaded by combination `worldId` and `name`. New `run()` start the transferred script over again, Considering the current inventory. Use the saved line to control the saved line [Manager and Panel](DASHBOARD.md).

Pass it to cancel `AbortController().signal` in `run()`, and then call `controller.abort()`. At the end of the application, always wait `close()`, I want the memory records to end.

## Conduct and extension

```js
const agent = createMinecraftAgent({
  name: 'Blake', worldId: 'my-survival-world',
  brainOptions: {
    defense: { attackPlayers: false },
    storage: false,
    night: false,
    hunting: false,
    spatial: { maxEntries: 2048, maxAgeMs: 7 * 86400000 }
  }
});
```

By default, the profile contains protection, Lute selection, Nutrition, Equipment, Night behaviour and hunting. Disable certain policies through `brainOptions`, If they don't fit your application. The script replaces only the long-term survival goal; Responses to threats continue to work.

`agent.client` gives access to OMConnect, `agent.manager` — to manager. Before manual `client.execute()` Stop automatic work via `pause()`. For his own transport, Reactor planner or set available `createMinecraftBrain`, `createCore`, `createScenario` and adapters. [Memory and computation architecture](PLATFORM-06.md).

## Reproducible check in Minecraft

```powershell
$env:MC_USER = 'AtlasTrial01'
$env:MC_WORLD = 'my-survival-world'
$env:MC_PORT = '25565'
npm.cmd run test:live:agent
```

Script `examples/agent-live.js` requires empty start-up equipment and sets five goals: Wood by class → crafting table → wooden pick → Stone pick → Boiler. It doesn't issue items or change the server rules. Storages are disabled to isolate the check, Sleep and hunting. Result, Action, metrics and memory recovery are recorded in a separate file `data/agent-live-<timestamp>.json`. Failures maintained as `incomplete` and non-zero exit code. It's not a full-game test.
