# Stable 1.0 readiness

Current beta: **1.0.0-Arthas-beta1**. See the [current navigation/combat audit](BETA1-NAVIGATION-COMBAT.md) and [beta verification evidence](results/arthas-beta1-validation-2026-10-15.md). Earlier counts and findings below are historical snapshots, not the current test total. An independently verified empty-inventory Dragon victory is still required before declaring stable 1.0.0.

Current development evidence (October 14): 527 automated tests, a bounded live PPO transfer and a six-stage empty-inventory survival run passed. Native high-level actions remain verified on Java 1.21.1. Full autonomous Dragon completion and a comparative platform benchmark remain unconfirmed, so stable 1.0.0 is not declared. [Current results](results/overmind-migration-2026-10-14.md).

The audit below is the historical October 13 baseline.

Date: **13 October 2026**. Audit performed on work assembly `0.7.0-dev.0` before these changes are included in the release 0.7.0. Author: **y9kudo**. This document assesses the readiness of the future 1.0; Output 0.7.0 Description [separately](releases/0.7.0.md).

**Decision: Continue preparations, Version 1.0 Not yet announced.** Automatic checks and archives are performed. But the last game run by five agents did not confirm receipt of the diamond kit, Autonomous passage from empty equipment to dragon has not yet been confirmed. No comparative test with other platforms.

## Checks

| Verification | Results and boundaries |
|---|---|
| `npm.cmd run check` | 436 Test passed; Validin case configuration. Symulators and fake events do not replace Minecraft |
| `npm.cmd run test:types` | Strict verification of public declarations and three examples TypeScript I'm past; added to CI |
| `npm.cmd run release:check` | Package versions, authorship/MIT, Archiving composition, Relative imports and references of documentation |
| `npm.cmd run test:package` | Archives are set up in a separate project without Mineflayer; imports, Data deferred, Mission, CPU-the racing and completion of work has been completed |
| `npm.cmd run test:runtime` | 20 Search on synthetic map, Same job: 30 000 knots. Maximum delay of the control timer: 919,96 ms synchronous and 30,38 ms punc |
| `npm.cmd run test:cpu` | 13 Search attempts. Timer delay: 296,48 ms in the main stream and 16,12 Mr. and a vorker; The task time is close 296 and 326 ms, respectively |
| `npm.cmd run demo:evidence` | One failure to start the condition prevents 19 Inapplicable attempts in the synthetic world; Change of support leg allows route |
| Game, Five agents Java 1.21.1 | Objective not achieved. [Conditions and results](results/cooperative-diamonds-2026-10-13.md) |

The calculations are taken from this PC and Node v24.19.0. The pore processing and vorciers improve the accessibility of the main cycle, But there was no acceleration of the total task. These numbers are not online pinging, FPS, TPS or a promise of the agent's reaction to 30 ms. The cost of producing a world image and a peak memory requires a separate measurement; limit JS heap The vorker doesn't limit the entire memory of the app.

The installation wasn't originally unconnected: Cash npm no addiction (`ENOTCACHED`). After the authorized download, the test passed. The duration of the sub-contracting control teams is now limited to a time-frame-Out.

## Subsystem status

| Area | Confirmations and remaining tasks |
|---|---|
| Transport | OMConnect Does his own actions and does not import Mineflayer. Uses protocol libraries, Data, and NBT; Independence does not mean no dependence |
| Versions | Personal Profiles Java 1.21 / 1.21.1. Knowledge of the number of the other version does not mean the person who performed it is ready |
| Java 26.3 | The experimental profile came to the chunks, Sustainable game cycle not accepted. Do not list audited versions |
| Authorization | Microsoft-Cancellation module and test/Token concealment exists. The real entry of the licensed owner requires a separate game test |
| craft | There are blocks classes, Lazy server directory, Craft and float confirmation. Fashion catalogue does not mean the execution of an arbitrary fashion mechanism |
| Movement | Ground search, Bridges, Pole, stairs, Swimming and air operations carried out in parts. Need a general contract of collisions and support between search and execution |
| Learning | Small local networks rank the cost of traffic and action; The model of experience brings out limited operator hypothesis. Universally trained mechanic model Minecraft not implemented |
| Cooperation | Channel outside the chat room, Applications, There are reserves and receipts. The latter group did not confirm the successful exchange; We need a business arrangement and a secure meeting |
| Construction | NBT/Litematica/Sponge/Sub-group legacy They're on it. Playing is tested worldwide. Large scheme not completed: Partial supports, Decorative conditions and temporary forests remain challenges |
| End | Prepared by Avery07 confirmed the dragon's own fall and death. It's a fight with equipment, by the person |
| Panel / SDK | There are statuses, objectives, Global governance and viewing; Declaration API checked TypeScript. Common reasons for waiting and a decision log are needed |

## Audit corrections

1. Structured Movement Errors. The History of the Core Saves `failure.code` and participating observations.
2. [Evidence Memory](INTELLIGENCE-METHODS.md): general memory of start-up preconditions, Rechecking when participating blocks change, Isolation of Worlds/of the measurement system/Traffic modes, Limited Log. For the rest of the refusals — local time delay.
3. The server recipe book received replaces the previously introduced version directory, including cleaning of the cache of exits.
4. Strict verification TypeScript in CI; amended contract for additional physical design parameters.
5. Installation check limits the duration of the subsidiaries and hides service windows Windows.

New memory checked automatically; The impact on the game result is not yet measured. Old adapters without structured failures are still using old euretics.

## Priorities before 1.0

| Priority | Task | Reception |
|---|---|---|
| P0 | General geometry: Panels, Stage, cutter Y, doors/hatches, stairs | Uniform forms and search routes/Physics/Vectorize; Playways without cycles and systematic adjustments |
| P0 | Evidence of receipt | Linking the Living Being, Current position, approach, disappearance and the slot; A person's choice is not considered a success |
| P0 | Breaking the impasse and safe mining | Limited repetition, A known return route, Health budget/Food and an explanation for changing strategy |
| P0 | Group production plan and meetings | Diamond target for the whole group, confirmed transfers, De-reserves after death, No duplication |
| P0 | Autonomous expedition | The New World, empty equipment, without extradition/Transporters/Commands: Survival → non-ser → Fort → portal → crystals → The dragon's own loss and death |
| P1 | Version support contract | For each version announced: Incoming, Cupboards, traffic, Mining, equipment, craft, Revival and transition of measurement |
| P1 | Construction Dependence | Temporary support, multi-unit objects, Replacement of Unbelievers, Renovation and exact comparison of the final scheme |
| P1 | Observation / speed | p50/p95/p99 Delays in the urgent decision, Search and Correction; limited calculation line |
| P1 | SDK For new recruits | Installation from zero, Minimum agent, JSON-Mission, The wider skills and understandable mistakes; Examples in the CI |
| P1 | Microsoft / Fashion | Selected games tests of accessible accounts and exact downloader combinations/version/mechanism |

## Proposed modalities for release

These are future criteria, Not the results already achieved:

- Full set and installation of archives are in CI Total Windows/Linux, Node 22/24.
- For the first vanilla-profile: Three selected different fresh worlds, Two independent runs. All outcomes published. Target threshold — Six confirmed passes; Change of conditions announced in advance.
- A selected set of routes checks mines, Partial supports, Falls and occupied passages. One refusal does not repeat itself indefinitely without new information.
- Five agents confirm diamond kit for each and retain resources in transfers; External issuance excludes launch «from zero».
- Calculation, event loop, The connection and the load of the game server shall be measured separately. CPU/RAM and number of agents included in the reporting.
- Documentation lists verified profiles and mechanics; Experiments are clearly marked.

The same primary worlds are needed to compare platforms, Objective, Equipment, Observation and computer budget. The historical race of opportunity in the world is useful in finding mistakes, But it doesn't prove the superiority of the platform.

[The following methods](INTELLIGENCE-METHODS.md): Sustainable Land Management, Production agreements, Rehearsal and diagnostic checks. The result is to reduce errors and increase the number of targets completed under the same conditions.
