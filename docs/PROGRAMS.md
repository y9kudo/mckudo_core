# Agent programs

A program is a JSON document describing **what should happen and under which observed conditions**. The dashboard edits it as blocks; JavaScript applications execute the same document with `agent.runProgram(program, options)`.

## A first program

```json
{
  "schemaVersion": 1,
  "name": "First tools",
  "nodes": [
    {"id": "wood", "type": "resources", "targets": {"#logs": 4}},
    {"id": "tools", "type": "resources", "targets": {
      "minecraft:stone_pickaxe": 1,
      "minecraft:furnace": 1
    }}
  ]
}
```

`id` identifies a block; use a unique value containing lowercase letters, digits, `_` or `-`. `title` is optional display text. `nodes` run in order. A resources block completes when its targets are observed in inventory/equipment. It delegates recipe and source planning to the kernel, so you do not have to list every crafting click.

## Block types

| Type | Fields | Completion |
| --- | --- | --- |
| `resources` | `targets`: item/class → count | Targets observed in inventory/equipment |
| `navigate` | `position`, optional `range`, `bridge`, `excavate` | Reachable destination reached by normal navigation |
| `action` | `action: {skill, args}` | Registered action reports success |
| `scenario` | `scenario`: existing scenario document | Scenario controller reports completion |
| `sequence` | `children` | All children finish in order |
| `parallel` | `children` | All children finish through interleaved decisions |
| `if` | `condition`, `then`, optional `else` | Selected branch finishes |
| `repeat` | `count`, `children` | Children finish `count` times |
| `until` | `condition`, `maxIterations`, `children` | Condition becomes true before the iteration limit |

Each block can set `priority` from -100 to 100 to adjust competition between parallel goals. One agent has one physical executor. Parallel control flow can keep multiple goals active, while their physical actions execute one at a time. Urgent core policies such as defense can take priority.

An if condition is evaluated when that block is first reached and selects one branch for that execution. An until condition is evaluated from new observations before continuing its next iteration. Reapplying a program resets its execution state. Already completed top-level tasks can be retained in saved queue state; unfinished scenario controllers rebuild their plans from current observations after restart.

## Conditions

Conditions use JSON Pointers into the latest observation. `/inventory/minecraft:oak_log` reads the count of that exact item. Namespace colons need no escaping; an item ID containing `/` uses `~1` in its pointer segment. An unavailable fact fails an ordinary comparison.

```json
{"fact": "/self/health", "lt": 10}
```

Available comparisons are `eq`, `ne`, `lt`, `lte`, `gt`, `gte` and `exists`; use exactly one comparison per fact. Combine conditions with `all`, `any` and `not`:

```json
{
  "all": [
    {"fact": "/time/isDay", "eq": false},
    {"fact": "/dimension", "eq": "minecraft:overworld"}
  ]
}
```

## Nested example

```json
{
  "schemaVersion": 1,
  "name": "Prepare supplies",
  "nodes": [
    {"id": "stone", "type": "until", "maxIterations": 4,
      "condition": {"fact": "/inventory/minecraft:cobblestone", "gte": 4},
      "children": [
        {"id": "gather-stone", "type": "resources", "targets": {"minecraft:cobblestone": 4}}
      ]
    },
    {"id": "equipment", "type": "parallel", "children": [
      {"id": "pickaxe", "type": "resources", "targets": {"minecraft:stone_pickaxe": 1}},
      {"id": "furnace", "type": "resources", "targets": {"minecraft:furnace": 1}}
    ]},
    {"id": "pause", "type": "repeat", "count": 2, "children": [
      {"id": "wait", "type": "action", "action": {"skill": "wait", "args": {"durationMs": 1000}}}
    ]}
  ]
}
```

This program obtains its resources through normal game actions. It can still fail when resources are unreachable, the world changes or the server rejects an action. Inspect the failed block's reason, adjust the program or environment and retry. Three consecutive action failures fail the current program leaf. Cancelled actions remain pending.

## JavaScript integration

```js
import {readFile} from 'node:fs/promises';
import {createMinecraftAgent, validateAgentProgram} from 'overmindmc';

const agent = createMinecraftAgent({
  name: 'Atlas', worldId: 'my-world',
  connection: {host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline'}
});

try {
  const program = JSON.parse(await readFile('agent-program.json', 'utf8'));
  validateAgentProgram(program, {skills: agent.client.describe().skills});
  await agent.runProgram(program, {timeoutMs: 600000});
} finally {
  await agent.close();
}
```

For custom applications, `createAgentProgram({program, skills, scenarioFactory})` exposes a reactor, `recordResult(event, action)` and a snapshot of block states. Attach it through the existing task queue to keep physical results correctly attributed. The scenario factory is required for resource, movement and scenario blocks; `createMinecraftAgent` supplies the normal core controllers automatically.

Programs allow at most 128 blocks, eight nested levels and 60 KB of JSON. Repeats and until loops are limited to 64 iterations. Validation rejects unknown fields and unavailable skills before applying a program. JavaScript exports are editable local applications; the dashboard API accepts program data and never evaluates source strings.
