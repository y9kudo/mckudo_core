# Changelog

## 1.0.0-Arthas-beta2 · Navigation, World Intelligence, Cognition and Task V2 development

### Task Orchestration and Recovery V2 increment

- Added task dependency validation, fresh resource guards, bounded dynamic priorities, retry backoff and per-action cancellation deadlines.
- Added fingerprinted task/program checkpoints, nested scenario memory and conservative reconciliation of interrupted mutations.
- Await durable preparation before physical dispatch and completion persistence before the next action; storage failure blocks further work.
- Added checksummed JSON envelopes, beta1 import, one verified backup and separate frequent task-state storage.
- Added opt-in bounded reconnect/death recovery; explicit pause/disconnect cancels recovery. Dashboard retains dependency queues in JSON and exposes blocked/uncertain states.
- Verified three navigation tasks across reconnection and a separate Node.js process restart on local Java 1.21.1, with an independent observer and no damage/corrections. This is not autonomous campaign acceptance.

- Added the Cognitive V2 decision cycle with shared arbitration, hard emergency priority ordering, bounded learned assessment and an observable decision journal.
- Added explicit reactor prerequisite/effect contracts, optional adapter outcome verification and `EFFECT_UNCONFIRMED`; verified symbolic `progress` now trains the neural planner.
- Added bounded symbolic suffix/connector repair, independent per-goal caches and context-sensitive temporary operator exclusions, with full-planning fallback.
- Added validated cognitive planner portfolios and adapters for existing HTN/MCTS implementations. All proposals remain subject to the action model and fresh observations.
- Added immutable cognitive checkpoint comparisons, train/evaluation modes, session-scoped provenance, regression rejection and schema-1-to-2 neural-planner memory compatibility.
- Added `experience:transition` evidence events, cognitive history persistence, dashboard decision diagnostics and the explicitly offline `benchmark:cognition` comparison in CI.
- Audited module dependencies and captured the beta1 planning baseline; added the V2 migration and compatibility plan.
- Added directed regional route hints, incremental LPA* graph repair and bounded long-distance navigation sessions.
- Added expiring scoped route memory, live revalidation of imported hints and cancellation of superseded searches.
- Shared collision/body geometry between physics and volume queries; exposed partial support queries and pure multi-tick predictions.
- Integrated segmented ground execution, early stuck detection and bounded goal recovery while retaining ordinary A*, native fallback and one physical action executor.
- Added public V2 JS/TS APIs and deterministic offline navigation benchmarks. Real server trials and remaining Phase A mechanics are separate acceptance work.
- Added a scoped, bounded World Atlas with observed region coverage, hazards, anchors, directed transition history, TTL/LRU eviction and invalidated return-route hints.
- Added transactional SQLite schema-1-to-2 migration and batched atlas persistence while preserving existing observed blocks and air tombstones. Agent JSON checkpoints retain their outer schema and now persist atlas state separately.
- Added occlusion-aware frontier ranking in CPU workers and multi-goal exploration with one global expansion budget. Visits, policy revisions and atlas changes invalidate cached requests.
- Added a contextual 24–16–3 network for transition failure, measured duration and damage. Neural memory schema 3 preserves legacy schemas 1/2; geometry-aware failure penalties and masked approximate labels retain deterministic route safety.
- Captured pre-traversal context and measured/estimated timing flags in OMConnect events; brain stop/start now detaches and restores learning/atlas listeners without duplication.
- Passed a non-destructive Java 1.21.1 movement and atlas persistence/reconnection check. This is separate from long-distance, learning-quality and autonomous campaign acceptance.

## Arthas release preparation · unreleased

- Multi-goal OMVectorize A* shares one frontier and budget across up to 128 candidate destinations. OMConnect selects block-interaction positions through this search and reuses its validated route.
- Symbolic domains support up to 2048 operators with backward causal slicing, a stable binary cost heap, cooperative search and explicit diagnostics. The core no longer silently truncates the domain at 64 operators.
- Scenario memory retains its observed home origin and loop-erased approach corridor; shelter preparation can follow reverse segments out of a mine instead of repeatedly searching for an underground building site.
- Route read views and resource indexes invalidate by changed vertical section; duplicate block states and unrelated surface edits preserve valid underground work. Blocked searches remain cached until relevant inputs change.
- Bounded ascent recovery clears headroom, prepares permitted step support and climbs through ordinary actions. Retreat considers one-block rises/descents through shared search; unarmed recovery avoids chasing distant hostiles and a failed retreat no longer hides its attacker.
- Terrain clearance explicitly distinguishes breaking a block from harvesting its drops. An unarmed survivor can open a safe ascent without inventing stone loot; short uphill retreats can clear permitted foliage while retaining mining-time and protection limits.
- Added a read-only local expedition monitor and concise application examples. Moved personal gameplay drivers and reports into an ignored local QA archive while retaining public API tests and CI.
- Stable Arthas acceptance is still in progress; this entry does not declare an autonomous Dragon victory or publish a new version.

## 1.0.0-Arthas-beta1 · 2026-10-15 · beta

- Continuous supported walking with bounded lookahead, optional clear-corner shortcuts and immediate route invalidation after a server correction.
- Validated, expiring kernel-to-client route handoff to avoid a duplicate search.
- Dedicated reactive combat controller: nonblocking aim/guard decisions, body-volume reach, voxel occlusion, shield direction, weapon selection and safe critical opportunities.
- Snapshot-derived target motion, bounded jump/landing prediction and continuous smooth bow/crossbow tracking throughout draw and release.
- Weapon commitment prevents shield flicker from starving charged attacks; directional shield flanks, cooldown spacing and guarded movement retain terrain safety checks.
- Ranged aim failures fall back to approach. The duel example records bounded motion/aim traces and distinguishes attributed arrow damage from projectile release confirmation.
- Independent projectile defense interrupts ordinary work or bow draws, anticipates observed aimed bows and releases the shield after danger clears. Sparse arrow snapshots receive a bounded defensive physics read view.
- Resource goals can prepare a supported side column for floating minerals, gather construction stock, attach an underside catch platform and mine after verified jump-placement. Added a goal-only flat-world diamond trial with a resumable local journal.
- Combat pursuit distinguishes sent attacks from attributed damage; transient stale searches can replan without suppressing defense.
- Directed navigation failure memory, schema-one migration and exclusion of transient occupancy/correction failures.
- Common configuration/play ping responses fix a LAN login stall. New automated regressions and a bounded live navigation probe.
- Route-cursor integration tests use the real 50 ms physics cadence alongside the 25 ms steering loop, removing an artificial tenfold physics acceleration that caused intermittent CI overshoot without relaxing movement assertions.
- Core, standalone OMConnect, OMVectorize identities and declarations use `1.0.0-Arthas-beta1`. YourMind remains `alpha1.0`.

See [beta1 details](docs/releases/1.0.0-Arthas-beta1.md) and the engineering audit.

## 1.0.0-Arthas-dev.3 · 2026-10-15 · development preview

- Added a focused fresh-spawn Nether visit profile, persistent exploration-distance completion, and a documented live-trial launcher.

- Added a local 3D debugger for received world geometry, Minecraft textures/models, routes, waypoints, gaze, targets, entities and protected regions.
- Added local client-JAR/resource-pack import with bounded in-memory asset resolution; game assets are excluded from source archives.
- Added a visual program editor and shared JSON runtime with sequence, parallel goals, if/else, repeat and bounded until control flow; programs can be exported as runnable JavaScript.
- Added `runProgram`, portable program validation, per-block execution state and task-queue persistence.
- Added official historical version discovery, server preparation and explicit experimental vanilla profiles; fixed 1.20.4 recipe dimensions and recipe identifiers, legacy world batches, slot IDs and version-dependent tracked blocks.
- Rewrote the README and dashboard instructions for the current build. Wider version support and autonomous Dragon completion remain evidence-gated.

## 1.0.0-Arthas-dev.2 · 2026-10-14 · prerelease

- Packaged the OvermindMC migration, expanded learning APIs, optional C computation and survival recovery work as the second Version Arthas preview.
- Synchronized package manifests, lockfiles, runtime metadata, display labels and TypeScript declarations across OvermindMC, OMConnect and OMVectorize.
- Added versioned release notes and a tested GitHub prerelease pipeline for the Arthas development branch, with installation archives and SHA-256 checksums.
- Kept prior test evidence under its original version. Autonomous Dragon completion and the wider C migration remain development milestones.

## Native C groundwork and expedition recovery · Version Arthas · 2026-10-14

- Added an optional C/Node-API kernel for static ground A*, wire framing/VarInts and explicit dense-network inference, with bounded asynchronous search and a JS fallback.
- Added a reproducible native benchmark, compiler entry point, package API and mandatory Linux native CI checks. The wider C migration remains in progress.
- Added campaign heartbeat, stage/status tools, learning evidence, durable segment journals and resume checks, including interrupted-process recovery.
- Retained workstation ownership across restarts; fixed interactive-support placement and provided safe workstation alcoves.
- Preserved ownership on duplicate block updates and furnace lighting changes; recorded exact server-confirmed placement coordinates. Pillar clicks also crouch on interactive supports.
- Added supported climbing out of caves, conservative returnable cave reconnaissance, target visibility before walking and ground-edge alignment.
- Moved cave route computation to independent worker requests; expanded food acquisition and navigation recovery policies.
- Stable 1.0.0 remains gated on an independently reviewed empty-inventory campaign ending in an own confirmed Dragon kill.

## OvermindMC migration and expanded RL · Version Arthas · 2026-10-14

- Renamed the kernel, standalone client and spatial layer to OvermindMC, OMConnect and OMVectorize. Canonical package entries and public declarations use the new names.
- Added categorical PPO and discrete SAC, physical worker environments and an opt-in native RL control bridge.
- Added a version/profile API and movement codec checks for all 30 installed transport families; corrected the legacy 1.7 eye-height field.
- Preserved legacy recipes with missing IDs/metadata as diagnostic records, and included legacy log/leaf families in resource classes.
- Indexed authoritative chunk sections for shared resource queries, bounded cache memory and stable descent heading; added leaf clearance before trunk mining.
- Translated source messages, dashboard and documentation to English. Curriculum memory now ignores display labels when validating task semantics.
- Published the original 0.1.0 archive in a separate GitHub branch with its original bytes, MIT and SHA-256.
- Live evidence: a bounded PPO transfer with 20 health/0 corrections, and a separate six-stage empty-inventory survival run in 161.12 seconds. Stable 1.0.0 remains gated on autonomous Dragon completion.

## Version Arthas · v1.0.0Arthas-dev.1 · 2026-10-14

- SemVer Packages: `1.0.0-Arthas-dev.1`, version name and displayVersion Available in metadata and panels.
- Curriculum extended c 3 to 20 Stages: Search, Rare resources, instruments, Stations, iron, diamonds and hazards. Scheme updated headless to 22 indicators/12 actions.
- The learning cycle is independent greedy validation Before promotion, Saves and Re-establishes the Model/Phase. The successes of the old batch Not certified by new phase.
- The Game Library contains 20 Resource phases with profiles wood/stone/iron/diamond. Real furnace test Survival 1.21.1: **6/6 for 181.064 with**.
- Re-choice of unaffordable tree species in class production, crowding out the core problem with a failure and namespacing new objectives.
- [Instruction](docs/ARTHAS-CURRICULUM.md) and protocol. Learning All Steps DQN and complete passage to the dragon has not yet been confirmed.

## 1.0.0-dev.1 · 2026-10-14 (Preassembly)

- Added opt-in API `overmindmc/intelligence`: Double DQN, Adam/Huber, replay and target network, Action masks, BC, weight transfer and conservative offline-Regularization.
- Headless skill-The environment is divided between limited workers; A clear one reset Saves the difference terminal/truncation. Reward API, potential shaping, bounded novelty and curriculum.
- HTN with alternatives, UCT MCTS, Priority objectives, optional GPT/Claude/local planner with validator/fallback budget requests.
- SQLite WAL-map of the identity of the world and tombstones, team envelopes, and verification of exchanges.
- Recovery API, heartbeat/watchdog, supervisor with the actual completion of the hangover worker, Prometheus and optional OTel tracer. Panel: Phase metrics and limited observation history.
- Survival: Cash of repeated requests for one count and priority of visible local stone. Fight: Flying objectives, shelter and limited digging of the building-protected escape.
- These modules are not declared complete Dreamer/MAML, PPO/SAC, PvP self-play, support to old protocols or scaling up 1000 Game clients. Stable 1.0.0 not issued. [Guidance and accurate status](docs/V1-INTELLIGENCE.md).

## In the design — Nezer and preparation of complete run, 2026-10-14

- Re-used `createNetherReactor`: Fortress orientations, Resource objectives, Hunting, mature growth, safety research/Tunnels and short bridges. [API and borders](docs/NETHER.md).
- Indirect exchange OMConnect With adult piglins, limited ingot flow and separate rebound confirmation; Keep gold detail of the armor. Added natural materials of Neser and priority for the gold craft of the nuns.
- Prohibition of water for protection in Neser, Non-combustible bridge materials/Poles, Re-ignition of the observed entire back-up frame.
- `from-zero-to-dragon.js`: Full test scenario, Damage magazines/attacks/adjustments, Maintaining phases and portals, continued, Stop, Post-death supply re-check. [Starting](docs/FULL-EXPEDITION.md).
- The result of the zombie game strike: A swift turn in the closet, Re-use in target displacement without protection off, immediate safe passage from close mob; corrected by double cooldown Protection.
- Finding a place for home no longer takes the grass for empty building cells. The shield and iron tools are fully profiled before the house.
- Game run discovered re-mining by a nearly broken brick: Resource planner now only considers suitable tools and orders replacement of worn copy.
- Before the descent, the full profile stores eight logs in class and a portable vertak; After the craft, the eye stores four pearls for emergency skills.
- **Version 1.0 not issued.** Autonomous passage through Neser before victory from zero is not confirmed; The potion and all Neser mechanics are not declared complete.

## 0.7.0 — 2026-10-13

[Description of release and proven opportunities](docs/releases/0.7.0.md). Personal Profiles Java 1.21/1.21.1; Auto-pass from zero to dragon not confirmed.

- Evidence Memory: Structured failures OMConnect The Ones in History OvermindMC. A confirmed start-up geometry may preclude the same unsuccessful attempt by another agent; The change in the facts involved allows for re-checking. Time interference has a limited local delay. [Methods and API](docs/INTELLIGENCE-METHODS.md).
- Training Audit 1.0 and public report of five agents 1.21.1: Diamond target not achieved, Traffic priorities identified, selection and cooperation. Added TypeScript-verification API in CI, Show memory without server and correct the switch from catalog to server data. [Audit](docs/V1-READINESS.md).

- Support WorldEdit `.schem` v2/v3 and safe sub-compatibility `.schematic`; Volume limits, Test of the palette and VarInt, retention `Offset`. Pistol Creative-The building picks an empty site, transmits properties through the component of the object `minecraft:block_state` and check the server status of each block; [instruction](docs/SCHEMATICS.md). Status support checked in game, a large user file is still being built.
- Creative-Flight through capability control and a three-dimensional route; Local Tub View and Settings Interface Humanize. Review extended to 24 default and independent task.
- A self-contained run with empty equipment in the new world started. The long start saves the full log, Interim report and trained models, Allows limited number of full-time rebirths. After the first death, the unreachable cycle was removed in the narrow passage: short safe move and temporary transition to combat instead of repeating one route. After meeting the Kryper, a safe sprint was added immediately without waiting for the full route; Agent makes a stone sword in front of the iron mine, And the first iron is directed to the shield. Watching sheep transmits wool color to prepare the bed. Test Log.
- OvermindMC Translating the battle with the sitting dragon into the immediate phase and looking for a confirmed ground approach to the head; OMConnect Chooses sword, Waiting for a backfire, Runs a jump to try to crease and checks the server damage. For flying purpose, the target is specified before firing, But charm «Infinity» recognized by wear of onions. Prepared by Avery07 confirmed the death of the dragon and 14 in-house hits on vanilla 1.21.1; critical multiplier and zero passage not separately confirmed.
- Automatic fall insurance: Support leg forecast, Water installation and recovery, In the event of a emptiness, the calculation of the throwing of pearls on the observed site. Eye protection from endermen also works in intermediate turning frames; Added regression tests. Full zero clearance not yet confirmed.
- OMVectorize plans limited air corridor and landing point; OMConnect Flying with an elite test, Missiles, flight and landing server flag. New operations of the storage facility carry the exact number, Read and sign the signs. OvermindMC sorts into six categories and resumes work on items in inventory. Test results.

- OvermindMC/OMConnect: policy `preservePickaxeTier` Saves iron and more valuable kirks when a small tool is available; Diamond ore and the only fit brick remain acceptable targets/Tools. Brain includes the threshold 2 default.
- OMConnect `collect`: A failed approach no longer blocks the remaining achievable positions; rejected approaches are not counted on every survey without changing the conditions. Received-still supported by server equipment.
- OvermindMC: repeated errors in the selection of one object increase the delay from the base `retryMs` to 120 seconds. Agent movement, The movement of the object and the change of measurement allow for a revision of the purpose.
- OvermindMC: A failed route is remembered before a change of position or a world is seen. The timer's break does not in itself return the impossible step to the plan.
- Bundle of the drawing: Continuing the historical race with previous names and equipment, Total active time and driver hashs; No circulation of the sole crafting table, Added transfer of junior curls after tool upgrade.
- Public, disfigured reports of two stages (30 minutes of active time), Regression tests and separate game diagnostics of the assembly. Historical images have not changed; There is no confirmed victory in the race. Old clients now clearly have an automatic rebirth off; The result after the first death is rejected.
- The corrected work assembly in a separate run continued with the resources of the former participant and confirmed the first diamond for 93,353 seconds: Ore destruction, of own selection and equipment. It's not a zero-sum mine or a historical score winner. 368 Automatic tests passed.

## 0.7.0-dev.0 — 2026-10-12 · development

- The loss of resources in perception is corrected: a dense nearby stone no longer replaces wood, Ores, and beds from the sample. Tree is selected according to the available class; checked for beryos in the absence of oak.
- Rock preparation opens a local safe ladder, When there is no spring (to reach). A fat agent first prepares tools, Then saves the meat; Critical protection uses the exit route if available `evade` At the adapter.

- Microsoft Auth code: Individual Cash, profile without currents in the photograph, separate time-Out and ban on late connection after cancellation. The real licensed entrance has not yet been tested.
- OMVectorize: 26 water, Intersection of body volume, air, asynchronous search and cancellation in changing the world; `swim`/`swimTo`, JSON-Mission, Mathematician of the elite.
- Reading Open server GUI, text/lore, Clear selections and the clicks from the safe audit. The window response is different from successful game mode selection.
- Landing and exit from the boat/Wagons in `set_passengers`, Locking of walking physics and cleaning of the reference in changing measurement.
- Fashioned machine box for imported data: Liquids, Catalysts, Energy, by-products, limited search, Balance sheet performers. Universal JEI-Exporter and Fashion Play Drives Not yet implemented.
- Expedition Log: current phase, Lack of progress, Confirming Your Self-Destruct to Win. Development is not a complete world.
- New modular/Protocol tests, example `test:live:07`, Documentation. CI misses the creation of a stable release for `-dev`.

## 0.6.0 — 2026-10-11

- The manager's work is closed to clients when memory failure or brain failure occurs; Closing is improbable, New commands after closure are rejected. The board releases the port even when the manager has failed.
- `release:check` Checks versions, Mandatory Import Files, Local links of documentation and exclusion of private/runtime-Data; `test:package` Establishes both archives in a separate application and checks the public API without Mineflayer.
- CI Checks Windows/Linux and Node 22/24; GitHub Release with archives and SHA-256 created after successful matrix. RowanRelease06 Five-stage survival with empty equipment passed; Full passage to dragon not declared complete.

- Simple API `mission/get/craft/goTo`, compiler `defineMission`, JSON-Figure with clues VS Code, Launch JSON Through `examples/mission.js` and separate game test `test:live:mission`.
- High-level reference target: Asynchronous sites A*, The relevance of the readings, Temporary elimination of failed points and resource sub-targets for missing bridge material. Technical `allowPartial` Returns intermediate target, without posing her as the final arrival.
- Bridges: server seat, Physical retention at the edge, Shut down the sprint on a narrow section, Checking block and inventory consumption before moving. Mount the appropriate support line. [Leadership](docs/MISSIONS-AND-BRIDGES.md).
- Protection of buildings in OMConnect: apparent areas of measurement, Conservative inspection of building blocks and neighbours, Recheck before changes. Resource brain excludes protected beams from wood class. Bridges, Poles, The beds and portals take into account the areas.
- Combat bypassing observed geometry without mining/Construction, Sky jumps, memory of progress and limits of persecution. Military errors are recorded separately for the purpose. [API and examples](docs/BUILDINGS-AND-PVP.md).
- Flashed after the player's descent: The bypass checks the remaining part to the brake point; corridor takes into account the player's final trace between intermediate counts.
- OMConnect Eliminates the accumulation of timer delays in physics, Keeping the goal 20 Steps/Without a series of pick-up packages. Selected Game Route: 19,97 Hz, 0 0 correction, Health 20/20; `npm run test:live:timing`.

- Real reused CPU worker for repeated A* Research, Total limited pool, cancellation, Time-Out, limitation JS-and validation of geometry; Short copying of the chocolate is still co-operative in the main stream. `createCpuPool`, `createExplorationPlanner`, `computation` in brain profile, `npm run test:cpu`.
- Additional delay removed 50 ms before protection after an event break. The expedition's crossings remember the observed portals in each dimension and do not consider the old coordinates as proof of the existing portal.
- The anticipatory protection takes into account the appearance of the bob: The stone wall does not cause an endless interruption of mining. OMConnect exports DDA `traceVisibility` on block forms. Hunting has a limit to pursuit; The miner returns to the confirmed upper stage from the dangerous impasse.
- Resource Planner Orders Cooking, gold smelting/Copper/Non-heritite scrap/Coal through the furnace recipes available to the performer; Wood Nether not selected by fuel. The game report of the expedition contains a relevant version and statistics CPU, Launching is awaiting a recipe server book.

- `createMinecraftAgent`: Small API Connectivity, scenarios, objectives, cancellation, Recovering and correct closure with memory. Policy setting via `brainOptions` available and available to manager.
- Spatial size-limited memory/Age, by the division of the worlds/and withdrawal of conflicting observations; Conservation through manager and use in resource research.
- OMConnect: Total calculation line with soft budget, Fair rotation, the number of tasks and the cancellation of; statistics `metrics.navigation`.
- World reading images track audits of affected chancs; The external updates don't cancel the calculation anymore.
- The exit from the work to the station was corrected: Ceiling and steps with secure adjacent blocks and suitable tool, Without the extraction of support.
- Search Saves Change in Selected Directions: The dug block is no longer considered as a future support, specified bridge to be counted before execution; clearance limited 32 block over route.
- Ah, the event awakening of threat testing during skill, Combining a set of events without parallel observations.
- Five-stage game test `npm.cmd run test:live:agent`, management API and description of the primary source architecture.

- OMConnect: `planRouteAsync` with limited calculation, peace audit cancellation and audit; Nativist navigation and the approach to the lute use asynchronous search.
- OvermindMC: `failureScope: action` for survival and the lute, Cash ID items and index of known sources, less than the state copy.
- Local timer statistics `metrics.timing` and off-supplier loading test `npm run test:runtime`. Details: [productivity](docs/RUNTIME-PERFORMANCE.md).

- Real local neurosync 12–16–1, backpropagation, replay and maintenance of navigation experience. The value of training is additional A* and mandatory physical verification.
- Individual Planner 24–24–1: Experience changes prescription ratings, sources and points of study; The dependency scheme remains tested by the world's recipes.
- Maintaining both models around the world/Agent, Craft chain and panel action log. The application for a resource shall take into account distance and a neuronetic assessment.
- Selection stops movement after the inventory has been updated; The disappearance of the essence without the Lut is no longer considered a success. Retrievation error corrected for another target.
- PvP: active arm and shield direction, server cooldown, Re-establishment of weapons after the second-hand shield, A simple jump before impact in a safe area, Selecting an axe next to outsiders.
- Command OMConnect extended to 20 Agents. Reproducible test `test:live:fleet-learning` Writes down the connection, Training, objectives and exchanges separately.
- Forecasting the intersection with players and excluding spectator of obstacles.
- The task line as a library Reactor; Block Editor/JSON, Repeat, Introduction and training.
- Delayed establishment of client registers, server recipes on request, Index drop when the recipe changes.
- Corrected calculation of repeated ingredients; Targets by class add up different wood species.
- Count of Zeli with limited versions; smith, grasshopper table, A plan for non-zeranite improvement and melting of ancient debris. Varca is still represented by the planner.
- Profile Java 1.21 near 1.21.1; Public version testing. 26.3 and the rest of the game adapters are not declared supported.

- OMConnect: `pillar`, `descendPillar`, `evade`, smooth onions/Abbalette, Protection from firing on a nearby crystal and a sitting dragon.
- Recording of blast and removal of crystal, Dragon server damage and death confirmation, Individual agent participation.
- OvermindMC: `dragonExpeditionScenario`, `createDragonPolicy`, Plan for reversible lift to the grate and change position for firing.
- Correcting return to station after each unit is produced, Unaffordable Goals and the Cancellation of the Player Roundup System; separate station observation budget.
- Launch `test:live:pillar` and `test:live:dragon`, Regression tests and guidance `docs/DRAGON-EXPEDITION.md`. Full passage requires a successful game report.

## 0.5.0 — 2026-09-30

- Assessment of falls, health reserve and de-blocking in front of other players.
- The portals act as a force, Eye observation, Maintaining inventory at measurement change.
- Public `createEndExpedition` and the test `test:live:end` with a confirmation log.
- Self-repository OMConnect, Updated types and instructions.
- Cleaning of local log and office files.

### Changes in kernel and performers after the initial 0.4.0

- `equipArmor`, On-board recording for purposes and separate display in the panel.
- `createNightReactor`, `createHuntingReactor`, `prepareBed` and `sleep`: Limited sleep attempts, Hunting and route approach.
- Navigation in eight directions, Test of diagonal angles and bypassing other players.
- `teamSupplyTargets`, `shareTeamSupplies`: Distribution of excess armor, tools and beds, while maintaining their kit and resources for unfinished purposes.
- Transfers of items choose a space with a distance from others. Partial transmission is kept in the journal and not repeated blindly.

- Ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, a,, a, a, a, a, a, a, a, a,, a,, a,, a,, a, a, a, a,, a, a, a,,, a,, a,, a,, a,, a, a,, 2×2/3×3, The creation and installation of the verstock/Boilers, confirmed bathing.
- Survival profile before diamond recruitment, Resource reservation between agents, Use evaluation and exchange of receipts.
- Swimming Eye, sprint and jumping in safe areas, Selection of bridge materials, Tracking the moving lute.
- Local Web-Panel: Status, objectives, Property, Hand-held teams and revival.
- Section pilitar search and reading corrected 1 290 Web-based recipes Java 1.21.1.

- `createMinecraftBrain` and `createStorageReactor`: Library &apos; s ready-made customized profile, Checking of chests, Back protection after two strokes by one player/Agent for 10 seconds.
- OMConnect: confirmed selection from the chest/barrels, The right choice of the tool for the slot, Responsive for Fight, Cleaning of obsolete sources of damage.
- Player observation, Priority views requestsa, `previewInteraction`/`runInteraction` and a log of mutual confirmations without a play chat.
- Automatic tests are separated from games; `npm test` No more picking up the file `examples/follow-test.js` like a normal test.
- OMConnect Selected in an independent package `packages/omconnect` v0.1.0: own contract, version, Documentation, Examples and tests.
- Added 1–10 clients and off-Chat communications: Address, TTL, Recurring and distributed intentions.
- The experience model removes the effects of operators from observations, filmes conflicting hypotheses and transmits the tested rules to the planner.
- Adaptive scenarios choose another way after changing conditions or error, Keeping the purpose and history of the editorial.
- Basic fluid physics/Special surfaces, Ballistics calculation, Action `shoot`, `drop`, `eat`, Observation and user skills OMConnect.
- The game trials of two and seven agents passed; The 10th entry is limited by the server response `server_full` (reported maximum 8). Advanced physics and shooting have so far been tested by automatic tests.

- OMConnect: session, line, peace, equipment, Physical and basic activities. First network profile: vanilla Java 1.21.1, offline.
- Public imports `overmindmc/connect` and `mckudo/adapters/omconnect`; Mineflayer/pathfinder displaced depending on development.
- Disruption of mining by priority action; Proof of damage by server updates, equipment selection; Treatment of falling items.
- Tactical Reactor, Rapid weapons selection, shield, Recharge account, acreage and threat testing at intervals 50 ms.
- Select alternative materials at observed distance; corrected preference for oak from-For the order of recipes. Pass through plants without conflict is accounted for by navigation.
- Scenario API, Examples of survival phases, Nether, Search for for a fortress and fight with a dragon; separate evidence log End. Full autonomous passage not yet confirmed.
- Guidelines OMConnect and scripts that distinguish between the planner and the adapter.
- Cluster Catalogues, Articles and prescriptions of a particular version; reading JSON from Java JAR/ZIP and opening tags.
- Multiple classes of blocks, Succession, User tags, Selectors and alternative sources of resources.
- Production chain planning, Responsive results and ingredients, instruments, Stations and fuel.
- Material class objectives, Choice of accessible wood, Common sources of conventional and deep ore.
- Own A*, Limited search budgets, moving on observed blocks, Passage and bridges.
- Search for surface exploration points and available depths; Resource Reactor Replanning.
- Search for blocks/entities on 128 default blocks, to 512; Client range request 16 chunks, to 32.
- Reactor API and JSON-format 4; Verification of threats during operation, Rescission with waiting and weapons selection before convergence.
- Protection against obsessives, derogation, A clear policy to respond to a player attack.
- Nutrition, Authorized hunting, mature cultures, Re-planting, Smooth, Coil and melting furnace.
- The drawing of the hideout, Production of the materials, Construction confirmation and survival phases.
- Updated types, Documentation of modules, Examples and automatic checks.
- Data checked vanilla 1.21.1: 1060 blocks, 1333 object and 1290 Reciprocal Files. Detailed separation of model and game tests: TESTING-04.

## 0.3.0

- Objectives in format configuration 3, Symbol Planner and review of proposed plans.
- Cash remaining steps, Change planning and re-observation before operation.
- Search restrictions, Number of challenges and attempts; brain memory 3.
- Perception format 1 and the path of conditions and decisions.
- craft in Mineflayer: Prescriptions, ingredients, and test results.
- The script for the vertex and sticks, :: Preparation of the game test vanilla 1.21.1.
- The configuration compatibility is maintained 1/2; LLM-Providers and game fashions remain separate integration.

## 0.2.0

- Self-directed manuals and examples of automation of resources and workshops.
- Version configuration 2: workflows, Dependency, until, budget of attempts and repetition.
- Progress in the challenges in memory 2; Read the old version 1.
- A clear recovery of interrupted steps instead of automatic repetition of unknown action.
- Skills plagins, Verification of arguments, Dependency and atomic registration.
- Runtime with restrictions on parallel agents and verification resourceKey.
- CLI init, validate and simulate.
- The user errors are isolated from the game results.
- TypeScript-Description, Scheme VS Code and verification of installation npm-package.

## 0.1.0

First independent API: Rules, Monitoring, skills, memory, Schemist and game adapters contracts.

MIT · The author y9kudo.
