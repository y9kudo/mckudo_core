# Simple objectives, Planning and bridges · 0.6.0

OvermindMC sets targets and picks the next step. OMConnect Gets the world from the server and takes a step through the player's online protocol and physics. A library user will be required to indicate the desired object or coordinates. Author of both systems — **y9kudo**.

## Minimum code

In the original download project, create `my-agent.js`:

```js
import { createMinecraftAgent } from './overmindmc.js';

const agent = createMinecraftAgent({
  name: 'Atlas',
  worldId: 'my-world',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1' },
  memoryDirectory: 'data/agents'
});

try {
  await agent.get('#logs', 3);
  await agent.craft('stone_pickaxe');
  await agent.craft('furnace');
  console.log(agent.snapshot().inventory);
} finally {
  await agent.close();
}
```

Set up a command-to-command relationship `npm.cmd ci`, run offline-server Java 1.21.1, Then execute `node my-agent.js`. Import in your locally installed package app `createMinecraftAgent` from `mckudo`. Installation instruction: [launch](SIMPLE-AGENT.md).

`await` means «Wait for the result». `finally` Closes the connection even when it is wrong. `worldId` — the permanent name of peace; For another world, choose another name. The player's name is written by Latin, to 16 characters. At every moment, the agent carries out one mission; consecutive `await` Keeps order.

## Three teams

| Command | What needs to be written | What makes the core |
|---|---|---|
| Get | `await agent.get('#logs', 8)` | Selects accessible wood and produces to the right amount |
| Prepare subject | `await agent.craft('stone_pickaxe')` | Planes ingredients, tools and tools, Considering the items already available |
| Go | `await agent.goTo({ x: 100, y: 64, z: -20 })` | Calculates observed sections of the route, Checks the support and prepares the bridge if necessary |

Quantity means **How many items to have**, including suitable gear. `craft('furnace', 2)` requires two ovens at the disposal of the; It's not an order to make two more, If they already exist. Both resource methods use a common receipt planner: The appropriate object found can also satisfy the purpose. `#logs` — Heading class; `#tree` includes leaves and is not synonymous with wood for craft. Uh-huh `craft` specify ID. Prefix `minecraft:` in simple API may be deleted.

If the ingredients are not available or the kernel passes, it shows the cause in `agent.snapshot().taskState`. Time-Out, Death and power-off end the call by error. Success is demonstrated by equipment or position, Not the fact of sending the act. The material already spent and the changes in the world are retained upon cancellation.

## Mission in one array

```js
await agent.mission([
  { get: '#logs', count: 3 },
  { craft: 'crafting_table' },
  { craft: 'stone_pickaxe' },
  { craft: 'furnace' },
  { go: { x: 40, y: 64, z: -20 }, range: 1, bridge: true }
], { timeoutMs: 600000 });
```

One team is selected at each step: `get`, `craft` or `go`. `count` default is equal 1, Acceptable 1–4096; Steps — 1–64. Time-It's in milliseconds: 600000 — 10 minutes. `get` and `craft` Also accept `{ timeoutMs, signal }` Third argument. `mission` and `goTo` Accept these parameters by second argument. Total range — 1 second–30 minutes, including connection.

Pass it to cancel `AbortController().signal` And call `abort()`, Either use it `await agent.pause()`. After the mission, the brain stops, and the connection remains open until `close()`.

## Only JSON

You can do without your own JavaScript. Create `mission.json`:

```json
[
  { "get": "#logs", "count": 3 },
  { "craft": "stone_pickaxe" },
  { "craft": "furnace" }
]
```

Check the file and run it:

```powershell
node examples/mission.js mission.json --check
$env:MC_USER = 'Atlas'
$env:MC_WORLD = 'my-world'
$env:MC_PORT = '25565'
node examples/mission.js mission.json
```

`--check` Checks structure without connection. Resource availability in a given world is determined after entry. Available for demonstration file `npm.cmd run mission:check` and `npm.cmd run demo:mission`.

B VS Code Scheme connected `schemas/mission.schema.json`: for `mission.json` and files `examples/missions/*.json` Field checks and tips. JSON uses double quotations; comment and comma after the last element not allowed. You can also connect the scheme to your project by setting up `json.schemas`.

For extended API `defineMission(steps, { name: 'My mission' })` Returns normal, validated `Scenario`. He can be assigned in line for manager. Details: [scenarios](SCENARIOS.md).

## How the core plans to move

Goal `go` is specified by the full leg coordinates in the current measurement. `range` from 0 to 8 sets the tolerance for each coordinate; to 0 You gotta get into the designated cell. Completion requires a support under player. Change of measurement stops this purpose with explanation; The next route is already in the new dimension.

Search A* works in portions through the total calculation line. One goal calculation is going to be investigated 4096 knots within 32 of the current position, with time limit 2,5 seconds. If the end point goes on, The kernel selects a proven intermediate area, it passes and re-considers the route for new observations. Unknown cup remains unknown: A confirmed support and free passage are required for the movement. Interim success does not complete the entire mission.

The cost of the journey includes traffic, Decline, Installation and permitted clearance of blocks. The training cost of navigation complements these mandatory checks. A failed point is temporarily deleted for 10 seconds, Then can be checked again. Updating of the readings, Position, protected areas or material reserves make it possible to re-calculate the plan. Errors do not remove safety restrictions.

By default clearance is off. To allow the normal soil to be preserved with protected structures:

```js
await agent.goTo({ x: 120, y: 64, z: 50 }, {
  range: 1,
  bridge: true,
  excavate: true,
  timeoutMs: 600000
});
```

To ban construction completely pass `bridge: false`. Protected areas are asked via `connection.protection`; [An example of home protection](BUILDINGS-AND-PVP.md). Target planner allows up to three blocks per transition with an assessment of the damage and health reserve. The offensive performer also checks each support before moving and stops the route when the server is readjusted.

Technical `planRoute({ ..., allowPartial: true })` Returns `partial: true` and `target` for the intermediate site. By default `allowPartial` off, The challenges continue to require a route to its objective. To connect navigation to its own transport `createScenario` accepts `navigationFactory(step)` with methods `react(observation)` and `recordResult(event, action)`. Method `react` Returns `null` after the confirmed achievement; `createMinecraftAgent` connects the implementation automatically.

## Bridges over deep-seated missing persons

Height doesn't turn the gap into a permissible fall. The kernel considers the progressive installation of a horizontal leg level support: a known empty place → block → verification → step. The depth under the bridge can be large; No movement on unknown or unconfirmed support.

If there is a lack of material, the purpose of navigation creates a resource sub-target `#stone`. The ordinary planner prepares the right tool and extracts the right kind of stone. Existing safe, complete blocks, including soils and boards, are recorded in reserve. Hypothetical training per unit is limited 32 Clusters; Long road is run by sections. Gross OMConnect self-uses existing materials; Automatic training adds OvermindMC.

The perpetrator selects expendable, complete fixed blocks, taking into account their value and reserve. Sand, gravel, Functional stations, Containers and valuable ore blocks are not used as accidental material. During construction, it includes a server and physics seat, Speed's dropping, :: On the base line and awaiting confirmation of the block and reduction in the quantity of the equipment. On a narrow section, the sitter holds the player at the edge. On observed wide surface, normal movement returns. Cancellation releases control.

The architecture described in the [Baritone principles A*, The total number of units per segment and unit cost](https://github.com/cabaletta/baritone/blob/master/FEATURES.md). B OvermindMC High-level goal remains part of the decision-making library, a Net execution — part of the independent OMConnect.

## Checks

`npm.cmd run check` Checks all core and client. New cases check simple format, Production of materials, An outdated plan, Temporary exclusion of a failed point, Check-in of arrival, Hold on to direct/diagonal edge, Bridge at altitude 100 blocks, consumption and cancellation of. High bridge verification uses a simulated world with a real physical step function; It doesn't replace the high-rise game run.

`npm.cmd run test:live:mission` start checking the target and the empty equipment. `node examples/mission-live.js --navigation-only` Checks separately the transition to the observed point. For repeat, choose a new English name through `MC_USER`. No items and teleporting server. The report with the steps list is maintained in `data/mission-live-*.json`; Uncompleted running returns the non-zero code. Actual results: Audit log.
