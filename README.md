# OvermindMC

### Build Minecraft agents with visual programs or JavaScript.

**Version Arthas · `1.0.0-Arthas-beta2` · Minecraft Java agent platform · Created by y9kudo · MIT**

[Quick start](#start-with-the-web-dashboard) · [Program builder](docs/PROGRAMS.md) · [API](docs/API.md) · [Planning](docs/PLANNING.md) · [Quality](docs/QUALITY.md) · [Contribute](CONTRIBUTING.md)

OvermindMC is a reusable library for building Minecraft agents. Give an agent a resource goal, a sequence of tasks or a conditional program. The kernel plans prerequisites, reads the connected world and asks its client to execute actions. You can build programs in the local web dashboard or write JavaScript using the same public API.

This beta2 source starts the V2 navigation migration. Stable Arthas still requires a verified autonomous Survival campaign ending in the agent's own Ender Dragon victory. [V2 architecture](docs/V2-ARCHITECTURE.md) · [Beta2 changes](docs/releases/1.0.0-Arthas-beta2.md) · [Changelog](CHANGELOG.md) · [Readiness criteria](docs/V1-READINESS.md).

**Start small:** ask for `#logs`, then a stone pickaxe and a furnace. Inspect what the agent observes, how it chooses actions and which outcomes the server confirms. Build a larger program from those same blocks.

## Core capabilities

- **Navigation V2:** bounded long-distance segments, directed regional hints, incremental LPA* graph repair, scoped route memory and explicit recovery budgets. [V2 API and integration boundaries](docs/NAVIGATION-V2.md).

- **Goal-driven resources:** plan tool, crafting and smelting prerequisites, select interchangeable block classes, gather construction stock and build supported access to elevated minerals.
- **Shared spatial search:** evaluate multiple destination candidates in one A* search and hand the selected route to OMConnect. The symbolic planner supports causal filtering and a stable cost frontier for larger operator domains.
- **Continuous ground steering:** bounded lookahead, verified corner shortcuts and velocity retained between compatible walking spans. Server corrections invalidate the old route immediately.
- **Reactive combat:** measured target motion, bow/crossbow tracking during charging, shield-aware weapon commitment, directional flanks and safe spacing. An independent projectile guard can interrupt ordinary work or a bow draw; terrain, reach and occlusion checks remain active.
- **More precise experience:** failed transitions no longer penalize every entrance to a destination. Temporary occupancy and server corrections do not become training failures.
- **Planner handoff:** the kernel can pass a short-lived, validated route to OMConnect without running the same search twice. LAN configuration ping/pong now completes before world readiness.

[Planning architecture](docs/PLANNING.md) explains the layers, budgets and public APIs. [Run an expedition](docs/FULL-EXPEDITION.md) or use the local progress monitor without connecting a second agent.

## Platform tools

- **3D world debugger:** received blocks with local Minecraft textures/models, route steps, program waypoints, current targets, entities, protected regions and the agent's view frustum.
- **Visual program builder:** resource goals, movement, skills, sequences, parallel goals, if/else, finite repeats and bounded until loops. Blocks and editable JSON share one document; export runnable JavaScript when you want to extend it in an editor.
- **Version API:** official release discovery, explicit transport capabilities and opt-in compatibility profiles. Gameplay support is tracked separately from codec availability.
- **Expedition monitor:** current campaign stage, actions, inventory, health and available computation counters from one configured local report. Start with `npm.cmd run expedition:monitor`.

## How the components fit together

| Component | Responsibility | Example |
| --- | --- | --- |
| **OvermindMC** | Goals, recipes, resource classes, control flow, survival policies, cooperation and learning evidence | Decide which nearby wood to gather and which prerequisites a furnace needs |
| **OMConnect** | Connection/authentication, authoritative world and inventory observations, physics and action execution | Dig a block, open a container, equip a tool and confirm the server's response |
| **OMVectorize** | Spatial calculations and routes | Plan a supported descent, jump, swim or bridge segment |
| **Agent Center** | Local controls, visual programming and debugging | Change a program and inspect its route in 3D |

The data flow is **server observation → kernel decision → spatial plan → client action → observed result**. OMConnect works independently of the kernel and does not require Mineflayer. The optional Mineflayer adapter lets existing applications use OvermindMC's planning layer.

## Start with the web dashboard

Use Node.js 24. From a checkout of this build, open a terminal in the project folder:

```powershell
git clone --branch feat/arthas-beta2-v2 https://github.com/y9kudo/mckudo_core.git
cd mckudo_core
npm.cmd ci
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_VERSION='1.21.1'
$env:MC_WORLD='my-survival-world'
npm.cmd run dashboard
```

Open **http://127.0.0.1:4180**. Start a compatible Minecraft Java server first; the default connection uses offline authentication. Use `MC_DASHBOARD_PORT` if port 4180 is already occupied. Change `MC_WORLD` when switching worlds so saved tasks and learning memory stay separated.

1. Select an agent and press **Connect**.
2. In **Program builder**, load **First tools & furnace**, or add your own blocks. A resource goal such as `minecraft:stone_pickaxe` asks the kernel to plan its prerequisites.
3. Press **Apply program**, then **Start program**. Inspect progress, inventory and failure reasons while it runs. **Pause** interrupts the current action.
4. Open **3D vision** to inspect received terrain, routes and waypoints. Click a block to see its state or add a waypoint above it.

The dashboard can use the installed Minecraft client JAR through `MC_TEXTURE_PACK`, or you can upload a client JAR/resource pack ZIP in **3D vision**. For example:

```powershell
$env:MC_TEXTURE_PACK="$env:APPDATA\.minecraft\versions\1.21.1\1.21.1.jar"
npm.cmd run dashboard
```

Textures and models remain local runtime data. They are excluded from the source package. The preview shows a bounded volume of received chunks, refreshes world snapshots up to twice per second and animates the view smoothly between snapshots. Unloaded terrain remains empty. [Dashboard and texture guide](docs/DASHBOARD.md).

## Build a program without coding

Start with **Gather resources**, then add **Move to a waypoint**, **If / else**, **Repeat** or **Parallel goals**. Select a block to edit its fields; after login, search item names from the connected version's catalog. Drag its handle to reorder it or drop it inside a group; arrow buttons provide the same ordering controls. Parallel goals interleave through one physical executor, while defense can interrupt ordinary work.

Use `#logs` to accept available tree species. Use exact item IDs such as `minecraft:iron_pickaxe` for crafted results. Conditions read observed facts such as inventory, health, hunger, time and dimension. Every loop has an explicit limit; reaching that limit reports a failure rather than running forever.

Switch to **JSON** to edit the same program directly. **JavaScript** shows an application generated from it; **Export JavaScript** creates a file you can edit and run locally. [Program format, conditions and examples](docs/PROGRAMS.md).

## Use the library in JavaScript

Build an installation archive from this checkout with `npm.cmd pack --ignore-scripts`. Install the resulting `overmindmc-1.0.0-Arthas-beta2.tgz` into your application with `npm.cmd install <path-to-archive>`. Add `"type": "module"` to that application's `package.json`.

```js
import { createMinecraftAgent } from 'overmindmc';

const agent = createMinecraftAgent({
  name: 'Atlas', worldId: 'my-survival-world',
  connection: {
    host: '127.0.0.1', port: 25565,
    version: '1.21.1', auth: 'offline'
  }
});

try {
  await agent.runProgram({
    schemaVersion: 1,
    name: 'First tools and furnace',
    nodes: [
      { id: 'wood', type: 'resources', targets: { '#logs': 4 } },
      { id: 'tools', type: 'resources', targets: {
        'minecraft:stone_pickaxe': 1, 'minecraft:furnace': 1
      } }
    ]
  }, { timeoutMs: 600000 });
} finally {
  await agent.close();
}
```

For short scripts, use `agent.get('#logs', 4)`, `agent.craft('crafting_table', 1)` and `agent.goTo({x: 10, y: 64, z: 20})`. For custom execution layers, use `createCore`, register reactors and supply an adapter. [Public API](docs/API.md) · [Scenario guide](docs/SCENARIOS.md) · [Independent OMConnect](packages/omconnect/README.md).

## Minecraft versions

Native high-level profiles currently cover **Java 1.21 and 1.21.1**. The version API distinguishes known catalogs, installed transports, native actions and live test evidence. Discovery can enumerate historical official releases; it does not enable an unsupported wire protocol.

The installed transport supplies 30 protocol families. Automated checks round-trip movement and digging through their actual codecs. Selected local server trials check whether a fresh agent can collect cobblestone. Additional vanilla profiles remain experimental until their gameplay paths pass those trials. [Version API](docs/VERSION-API.md) · Reproduce the version lab.

Forge, Fabric and NeoForge integrations use an explicit bridge contract and machine catalogs. Applications register executors for custom mechanisms. [Mod integration](docs/MODS.md) · [Machine recipes](docs/MACHINE-RECIPES.md).

## Learning, computation and validation

The platform includes CPU-based DQN, PPO and discrete SAC experiments, physical headless environments, curriculum stages, replay, rewards, HTN/MCTS planning and an opt-in live RL bridge. Learning requires measured training and evaluation. Optional LLM providers are separate from local execution. [Learning guide](docs/RL-PHYSICS-AND-CONNECT.md).

An optional C computation layer accelerates bounded ground search, packet framing and explicit numerical inference. JavaScript remains available as a fallback. [Native computation](docs/NATIVE-COMPUTE.md).

```powershell
npm.cmd test
npm.cmd run test:types
npm.cmd run release:check
npm.cmd run test:package -- --offline
```

The package smoke test installs both archives into a clean consumer; offline mode needs populated npm caches. Public source retains API/contract tests and CI. Game trials, personal journals, worlds, auth caches and texture archives stay in ignored local workspaces. [Quality policy](docs/QUALITY.md) · [Contributing](CONTRIBUTING.md) · [Full expedition instructions](docs/FULL-EXPEDITION.md) · [Roadmap](ROADMAP.md) · [License](LICENSE).

## Help build the platform

Useful contributions include reproducible navigation failures, exact-version gameplay trials, new action executors, examples and clearer beginner documentation. Start with a small case, explain the expected outcome and attach the observed result. [Report a bug](https://github.com/y9kudo/mckudo_core/issues/new?template=bug_report.yml) · [Propose a feature](https://github.com/y9kudo/mckudo_core/issues/new?template=feature_request.yml) · [Development guide](CONTRIBUTING.md).

If the project helps you, a star makes it easier for other developers to discover it. OvermindMC and its independent OMConnect client are maintained by **y9kudo** under the **MIT license**.
