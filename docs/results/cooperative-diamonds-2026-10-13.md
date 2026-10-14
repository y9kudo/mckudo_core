# Five agents: Cooperative diamond mining

Date: 13 October 2026. Working version: `0.7.0-dev.0` Locally modified. Minecraft Java vanilla 1.21.1, offline, world. Name given by user. This is a public description of the results; raw magazines and the state of the world remain in the ignored folder `data/`.

## Result

**Test completed without target: 0 from 5 agents received a full diamond kit.** In the second phase, no diamond agent has any. Uh-huh MrGiraffe6614 two iron bars in the last server inventory confirmed.

Second phase: 13:01:36.372–13:10:20.974 UTC, 8 minutes 44,602 seconds from report. This is a process interval, including connection and release of start-up supplies. It ended up shutting down all clients. User then completed test; No new game run during audit.

| Agent | Current phase of the plan | Death / Second-stage regeneration | Navigational errors | Rectine Errors |
|---|---|---:|---:|---:|
| ArKaDiU656 | Preparation of the furnace | 2 / 2 | 2 | 42 |
| `_FISTFIGHT_` | Preparation of the furnace | 1 / 1 | 6 | 51 |
| MrGiraffe6614 | Iron bar preparation | 0 / 0 | 3 | 12 |
| DERTKE | Iron bar preparation | 0 / 0 | 156 | 18 |
| LazyP1nk | Iron bar preparation | 1 / 1 | 49 | 16 |

«Iron bar preparation» — Planner &apos; s intention. This is not proof of the iron curry. Milestone-The log can maintain the previous stage after the loss of the object at death.

Coordination recorded 290 communications and 199 resource requests. The only record of an attempt to exchange: MrGiraffe6614 → DERTKE, `failed`. These counters confirm the coordination channel, but not successful joint production or transfer of items.

## Conditions and origin of resources

The first phase started with empty equipment. User provided chests with elites and missiles; These are external supplies, Not the result of the agent craft. After death ArKaDiU656 Another agent picked up his stuff. Selection of fallen objects is not considered to be an agreed transfer.

The second phase continued the same world and server equipment; `initiallyEmpty=false`. So the whole result cannot be used as a net measurement of the output from zero. Distribution of supplies remained incomplete: Three agents failed to return to surface storage.

Preliminary attempt Java 26.3 was a separate compatibility test. The entrance and receipt of the chancs took place, But the steady-state game cycle didn't go through. User switched the server back to 1.21.1 Prior to this test.

## Problems identified

1. Refuse «Start cell is not confirmed clear and supported» was not classified as old as «path/route». Retryings were made without changing strategy.
2. Ground planner requires full cubic support; physics has more detailed impact patterns. Their submissions need to be harmonized for steps, Tubes and foot chopping.
3. Lute selection often does not receive confirmation by inventory. The report does not allow for a single common reason: I need a path to approach, de-evaluation, moving item and changing slots.
4. Resource requests do not replace the distribution of production dependence and the achievable meeting places.
5. Several deaths and waste require separate protection priorities, Food and safe exit from the mine.

## Changes after stop

Structured failure codes added and [failure storage](../INTELLIGENCE-METHODS.md). A confirmed failure of starting geometry can be used by another agent, If he sees the same condition again. Change of support leg allows rechecking. Temporary disturbances are limited to pause.

New changes are checked automatically and in the synthetic example. **Replaying Game Proof 156 refusals DERTKE Not yet implemented.** Harmonization of geometry and reliability of command production remain challenges [Training 1.0](../V1-READINESS.md).
