# Challenges and relationships

Workflow — Objective, I'm sorry, but I'm sorry: Training workshop, deliver materials, perform a production transaction. It's different from rules, Who respond to the world continuously.

## Steps

Every step has a id and action. Additional fields available:

| Field | Appointment |
|---|---|
| dependsOn | ID Steps, which should be completed sooner |
| until | Observed fact, validation |
| maxAttempts | Total launch limit, default 32 |
| retryDelayMs | Initial delay after error; default failureBackoffMs |

If dependsOn missing, the step depends on the previous one. A Clear List [] Makes it independent. One agent carries out only one action simultaneously, Even if the graph allows several steps to be taken.

~~~json
{
  "schemaVersion": 2,
  "name": "WorkshopAgent",
  "worldId": "workshop",
  "workflows": [{
    "id": "materials",
    "priority": 20,
    "steps": [
      {
        "id": "logs",
        "action": { "skill": "gather", "args": { "block": "minecraft:oak_log", "count": 1 } },
        "until": { "fact": "/inventory/minecraft:oak_log", "gte": 2 }
      },
      {
        "id": "boards",
        "action": { "skill": "craft", "args": { "item": "minecraft:oak_planks", "times": 2 } },
        "until": { "fact": "/inventory/minecraft:oak_planks", "gte": 8 }
      }
    ]
  }]
}
~~~

It's a script for a simulation. The count shall be checked before starting: Unknown Dependence, cycles and re-emerging ID Reverse.

## When the Step Is Completed

1. If until already implemented and dependents ready, pass, Step is considered completed.
2. Otherwise, you're called by skill.
3. Where available until The core is re-observing the world and checking the result.
4. If not yet achieved, result — progress. Step will repeat at next appropriate tactic.
5. If until not specified, a successful completion is enough.

Each trigger takes one try, including progress. Cancel by user returns attempt. Errors add a pause with a delay of up to five minutes. If limit is exceeded, Step gets failed; The rest of the task is no longer being started.

Status of the task available in snapshot().workflows: completed/total, Status of each step, attempts, retryAt and error. A higher priority jet rule can be implemented between steps. Current action not automatically interrupted: for immediate withdrawal pause().

## Activation and repetition

Uh-huh workflow Maybe when. Once the condition has been met, the task is activated and remains active, Even if the condition later became false. The completed task does not start again automatically.

~~~js
await core.pause();
core.resetWorkflow('materials'); // Re-doing the whole task
core.resume();
~~~

For an erroneous or interrupted step, Save the remaining stages completed:

~~~js
await core.pause();
core.retryStep('materials', 'boards');
core.resume();
~~~

retryStep Starts a new budget for attempts just for the chosen step. No change in progress during unfinished action.

## Conservation and rehabilitation

exportMemory() includes progress in the tasks. Keep it after proven action with help FileMemory or its database. The game objects themselves and the world is not preserved in the memory of the core.

In recovery:
- Completed steps do not repeat;
- The pending steps remain dependent and budget;
- saved running becomes interrupted: unknown, Whether the game action was completed after the last recording. Need a clear one retryStep or resetWorkflow;
- modified definition of existing task is rejected by print. Use the new version ID task or consciously clear the relevant memory.

It's not a guarantee «Just once» In an accident between game action and file preservation. For irreversible actions, transport must maintain its own identifiers and confirmations.

Maximum: 16 tasks, 64 step in the task, 256 Step total per agent. Living Example — examples/workflow.js.
