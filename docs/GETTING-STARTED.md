# Getting started with OvermindMC

OvermindMC is a JavaScript library for Minecraft Java agents. The planning core decides what to do; OMConnect connects to the server and executes verified actions. OMVectorize supplies spatial calculations. All three components are authored by **y9kudo** and licensed under **MIT**.

## 1. Prepare the tools

Install Node.js 24 and VS Code. Open the project folder in VS Code and choose **Terminal → New Terminal**. Run commands from the folder containing `package.json`.

```powershell
npm.cmd ci
npm.cmd test
```

On Windows PowerShell, use `npm.cmd` if script execution policy prevents `npm.ps1` from running. You do not need to change the computer's global execution policy.

## 2. Choose how to start

For a visual interface:

```powershell
npm.cmd run dashboard
```

Open the local URL printed in the terminal, usually `http://127.0.0.1:4180/`. Select an agent, connect it, add a task and start execution. The panel exposes task blocks, JSON, inventory, observed blocks and diagnostic timings. [Dashboard details](DASHBOARD.md).

For an automated first test:

```powershell
node examples/curriculum-live.js --tier=stone --name=AtlasTrial --minutes=8
```

This expects an offline Java 1.21.1 server at `127.0.0.1:25565`, Survival and a fresh nickname. It collects logs by class, makes a table and wooden pickaxe, collects cobblestone, and makes a stone pickaxe and furnace. A report is saved even if the trial fails. It does not grant items or edit the server rules.

If your server uses a different address or port, set `MC_HOST` and `MC_PORT` before starting. `MC_VERSION` must correspond to a supported native profile. [Version support](VERSION-API.md).

## 3. Create your own application

In a separate application folder, install your current local checkout:

```powershell
npm.cmd init -y
npm.cmd install C:\path\to\mckudo_core
```

Replace the path with the actual library folder. Add `"type": "module"` to your application's `package.json`. Create `index.js`:

```js
import { createMinecraftAgent } from 'overmindmc';

const agent = createMinecraftAgent({
  name: 'Atlas',
  worldId: 'my-first-world',
  connection: {
    host: '127.0.0.1', port: 25565,
    version: '1.21.1', auth: 'offline'
  }
});

try {
  await agent.get('#logs', 4);
  await agent.craft('crafting_table', 1);
  console.log(agent.snapshot());
} finally {
  await agent.close();
}
```

Run it with `node index.js`. `await` means that the next goal waits for the previous one to finish. `finally` closes the agent even after an error.

`#logs` is a class, so the agent can choose an accessible nearby wood species. `crafting_table` is an item goal. The resource planner determines ingredients and checks server-confirmed inventory after each action. The `count` is the desired amount for the goal, rather than a promise that the agent can obtain it in an unknown world.

`worldId` identifies the world used for memory. Keep it stable for the same world. Set a new value after generating another world; old resource coordinates are only hints and must be revalidated.

## 4. Write a short mission

```js
await agent.mission([
  { get: '#logs', count: 4 },
  { craft: 'crafting_table', count: 1 },
  { craft: 'wooden_pickaxe', count: 1 },
  { get: 'cobblestone', count: 8 },
  { craft: 'furnace', count: 1 }
]);
```

A mission is a list of goals. The core supplies the lower-level actions, tool selection and checks. For more control, use a JSON scenario with resource, navigation and expedition steps. [Mission fields](MISSIONS-AND-BRIDGES.md) · [Scenario reference](SCENARIOS.md) · [JSON rules](JSON.md).

## 5. Try learning without Minecraft

```powershell
node examples/train-physical.js --algorithm=ppo --batches=400 --count=32
```

This trains a small movement policy on CPU and writes a checkpoint and report. It does not open Minecraft, call an LLM or use a GPU. To transfer that policy to a supported local server, run `node examples/rl-connect-live.js`. [Learning and its limits](RL-PHYSICS-AND-CONNECT.md).

## Connection problems

A refused connection usually means that the server is stopped, uses a different port or is bound to another address. An unsupported-version error means that the installed action profile is missing; do not force an older protocol number. A goal can remain blocked when terrain is unknown, a tool is missing, a region is protected or no safe route exists. Read the saved report or dashboard reason before changing the task.

`auth: 'offline'` is for servers that permit offline login. Licensed servers require `auth: 'microsoft'` and a Minecraft-owning account. Complete the device-code prompt outside the chat and keep the authentication cache private. [Authentication guide](../packages/omconnect/docs/AUTHENTICATION.md).

The renamed packages have not been declared published to npm. Local installation uses the current files; a historical GitHub archive contains its historical package name and APIs. [Migration guide](OVERMIND-MIGRATION.md).
