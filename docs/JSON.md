# JSON for automation Minecraft

JSON describes the data: Facilities {}, Lists [], The two-digit lines, Number, true and false. Comments and decimals after the last field are not allowed. B VS Code Project design gives the names of the fields and types.

## Self-contained configuration

~~~json
{
  "$schema": "./node_modules/overmindmc/schemas/agent.schema.json",
  "schemaVersion": 2,
  "name": "ResourceAgent",
  "worldId": "my-world",
  "rules": [
    {
      "id": "wood-reserve",
      "priority": 10,
      "description": "Maintain the supply of oak logs.",
      "when": { "fact": "/inventory/minecraft:oak_log", "lt": 8 },
      "action": { "skill": "gather", "args": { "block": "minecraft:oak_log", "count": 1 } }
    }
  ]
}
~~~

Rule will be implemented: «If the log is less than eight — Get another one». priority it makes a difference, more is chosen first. With equal priority, the jet rules go ahead with the tasks; The order of the list remains JSON.

Name name is related to the kernel agent. Game Nick is a gamer. worldId Separating the Memory of Different Worlds.

## Main fields

| Field | Value |
|---|---|
| schemaVersion | 4 for kernel with Reactor; 3 for purposes; 1 and 2 Maintain previous formats |
| rules | Reactive regulations, maximum 64 |
| goals | Desired states, to 16; see. [brain OvermindMC](BRAIN.md) |
| workflows | Final multi-step tasks, maximum 16 |
| tickIntervalMs | Pause between completed steps; default 1000 ms |
| actionTimeoutMs | Time to request a step cancellation; default 15000 ms |
| failureBackoffMs | Initial pause after a customary error; default 5000 ms |
| maxHistory | Number of recent results; default 50, maximum 200 |

I need one rule, Objective, target or connected via JavaScript Reactor. Format 4 allows configuration without behavioral lists, If `createCore` Received `reactors`. Names of rules, The tasks and steps should be unique in their lists. Errors indicate a path to the field, for example $.workflows[0].steps[1].dependsOn.

B 0.4 Action `gather` He also accepts the class, for example `"block": "#logs"`. For purpose «eight boards of any kind available» Use it `planResourceClasses` or `createResourceReactor`, Not the condition of a fixed tree number. Range parameters are in separate [perception.json](../examples/perception.json), which the app transmits to adapter. Examples: [AUTOMATION.md](AUTOMATION.md).

## Observations and conditions

fact — JSON Pointer to adapter data: /self/food, /self/health, /inventory/minecraft:bread.

| Operator | Meaning |
|---|---|
| lt | Less |
| lte | Less or equal |
| gt | More |
| gte | More or equal to |
| eq | Equal to the type of value |
| ne | Not equal to the type of value |
| exists | Fact present or not |

Number 16 different from the line "16". If not, The comparison returns false, including ne. For absence used exists: false. Adaptation should document available facts; zero objects and unknown number — Different states.

~~~json
{
  "all": [
    { "fact": "/self/food", "lt": 16 },
    { "fact": "/inventory/minecraft:bread", "gt": 0 }
  ]
}
~~~

all requires that all conditions be met, any — At least one, not invert one condition. Investment limited to eight levels. In a simple condition, one comparison is needed. Symbol / inside the key name is written as ~1, a ~ — How ~0.

## Skills

action.skill — Skills name, action.args — His arguments. JSON does not contain an execution JavaScript. For a new action, the developer has the skills to adapt or plagina.

| Skill | Accessibility and parameters |
|---|---|
| eat | Symulator and Mineflayer; item for Mineflayer |
| gather | Symulator and Mineflayer; block and count from 1 to 16 |
| goto | Mineflayer; x, y, z, non-binding range |
| craft | Symulator and Mineflayer; item and times (1–16 Prescription applications) |

The simulator knows the boards, Sticks and sticks. It's a limited test world. Mineflayer uses client's prescriptions and checks the results with the inventory; for 3×3 I need a set of rules.

For action chains, go to [the task book](WORKFLOWS.md), for their own behavior — to [Plagins](PLUGINS.md).
