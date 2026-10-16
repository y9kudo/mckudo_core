# OMConnect changelog

## 1.0.0-Arthas-beta2 · Navigation V2 development

- Add bounded navigation sessions, scoped route memory and incremental regional LPA* search while retaining local A*.
- Share body/collision geometry, expose partial support queries and reuse tick physics for motion prediction.
- Execute long goals through bounded ground segments; detect insufficient progress and expose typed recovery decisions.
- Keep existing APIs and deprecated aliases. Full fractional-height ground locomotion and mixed-transport execution remain separate work.
- Capture optional pre-traversal policy context and measured duration in navigation events. Mark approximate per-waypoint time/damage explicitly so downstream learning does not treat them as measurements.
- Add the shared `EFFECT_UNCONFIRMED` failure code for downstream observed-effect verification; packet and physical execution ownership remain unchanged.

## 1.0.0-Arthas-beta1 · 2026-10-15 · beta

- Continuous compatible ground spans and footprint-checked lookahead retain movement velocity.
- Internal one-use route handoff validates state before avoiding a repeated search.
- Reactive combat reassesses aim, shields, weapon choice, reach, occlusion and safe movement; temporary controls are released on cancellation.
- Derive aim velocity from position snapshots, reject teleport/outlier motion, and follow targets throughout bow/crossbow charge with bounded jump prediction and smooth angular feed-forward.
- Commit to a selected melee weapon through its cooldown, flank facing shields, maintain spacing and move slowly while guarding or drawing a bow.
- Expose optional `solveAim({ predictTarget })` for bounded nonlinear forecasts and preserve direct projectile identity in damage events.
- Correct native Java 1.21/1.21.1 arrow spawn ownership: spawn data carries the owner ID directly, whereas damage-event optional IDs use an offset.
- Reactive guard tracks incoming body intersections, anticipates aimed ranged weapons, releases after a short quiet period and reports server shield-block events separately from requested guarding.
- Pursuit requires observed damage to extend its encounter budget. Unrelated chunk updates no longer invalidate a cached combat route read view.
- Configuration and play common ping packets now receive pong, including id zero.
- Added cancellation, cadence, terrain, reach, route-handoff and protocol regression tests.

## 1.0.0-Arthas-dev.3 · 2026-10-15 · development preview

- Added bounded navigation debug snapshots for live 3D route visualization in OvermindMC.
- Added official release discovery/inspection and experimental vanilla compatibility profiles.
- Fixed Java 1.20.4 recipe dimensions and recipe IDs; adapted legacy chunk batches, world block updates, metadata slots and transaction-based crafting.
- Preserved strict separation between native 1.21/1.21.1 profiles, available codecs and experimental gameplay paths.

## 1.0.0-Arthas-dev.2 · 2026-10-14 · prerelease

- Synchronized OMConnect and OMVectorize metadata with the OvermindMC Arthas preview.
- Added an injectable ground backend, safer ground alignment, target visibility before approach, workstation provisioning and crouched placement on interactive supports.
- Retained confirmed placement ownership across restarts, duplicate block notifications and furnace lighting changes.
- Included installation archives in the OvermindMC GitHub prerelease. The optional C framing/search implementation is supplied by the core's native package entry.

## OMConnect / OMVectorize migration · Version Arthas · 2026-10-14

- Renamed client and spatial APIs; retained deprecated JavaScript aliases for migration.
- Added extensible version inspection, packet normalization and movement codecs, including finite legacy stance.
- Added ground planning to OMVectorize and kept route heading stable during descents.
- Added a bounded authoritative section index with compact cached selector positions.
- Updated messages and guides to English. Native high-level gameplay remains verified on Java 1.21.1.

## Version Arthas · 1.0.0-Arthas-dev.1 · 2026-10-14

- Added name Version Arthas and displayVersion v1.0.0Arthas-dev.1; Version synced with kernel.
- In composition OvermindMC client tested at Survival 1.21.1: Wood → crafting table → wooden pick → Rocket → Stone pick → Boiler, 6/6 for 181.064 c without server correction.

## 1.0.0-dev.1 · 2026-10-14

- Synchronized advance version with OvermindMC.
- Limited digging of the escape route, Priority of confirmed safe haven, Protection against unknown chess and dangerous neighbouring blocks.
- Neser's Changes Retained: Piglin exchange, Bridge materials and the prohibition of water in Neser.
- Extension of the game protocols and scaling up to 1000 No client is reported without testing.

## 0.7.0 — 2026-10-13

- Creative-Flight, Unit set with block properties, elites/Missiles, Warehouse operations and panels.
- Protection of the Eye from Endermen, Estimated waterfall/Pearl, The stairs and the near dragon phase.
- Rectification of selection and selection of tools, The version is a prototype profile. The Nativity Profiles remain Java 1.21/1.21.1; 26.3 Not declared supported.
- [Full description and proven capabilities](docs/releases/0.7.0.md).

- Structured land traffic failures (`OMActionError`) and certificate of observed starting conditions. Codes and block shapes are available to applications without OvermindMC.
- The server recipe book replaces the previous backup version directory and clears the indices.

## 0.7.0-dev.0 — 2026-10-12

- Microsoft Auth code, separate waiting for entrance, Net profile observations and blocking of late connection after closure.
- Independent OMVectorize: Water volume A*, air, Intersection of the body, Asynchronous budget and elitist pre-indicator; `swim`.
- server menus stored: reading title/name/lore, Selectors and `menuClick` Audited.
- `mount`/`dismount` confirmed by passenger packages; normal pedestrian physics is off in transport. Full steering/Flight not yet implemented.
- Library autonomy maintained: OvermindMC and Mineflayer No need.

## 0.6.0 — 2026-10-11

- `allowPartial` for A*: intermediate, `partial` and `target`. By default search-still needs an achievable end-state.
- Retention at the edge of the ground sitting, Network start/stop sneaking and safe completion of the administration. Bridge confirms block and reduction of inventory, Then lets you step. On a broad, verified support, normal speed returns; The installation rate corresponds to the support edge.
- Public `OMProtection`: to 128 Areas, Measurement, Heuristics of Buildings, Account for confirmed own installations; Checking built-in actions to approach and before dispatching change. A* accepts `canPlace`, clearance takes into account protection. [Documentation](docs/PROTECTION.md).
- Combat A* budget 1600 knots, No mining/bridges, step rise, Limiting unnecessary harassment between staff.
- Lateral throwing at the wall after descent corrected: Checking the player's bypass is limited to the current stop point. The corridor check includes the final position of the player's full track.
- Time schedule of physics relative to target time instead of accumulation of delay interval. Goal 20 Hz, without a series of steps/Packages after hanging; Stopping at death, change of measurement and unset. `npm run test:live:timing` in the source OvermindMC Checks the actual route and frequency.

- Public `traceVisibility`: limited DDA with exact intersection of block shapes, unknown cups remain untranslutable. OvermindMC uses it to eliminate false threats outside the walls.

- Total limited line A* with a sequential and a soft overall budget; statistics `metrics.navigation` and public `createWorkScheduler`.
- The world reading images are checked by the cups affected, without canceling search with foreign updates.
- Exit from work to workstation: A* can clear the height of the step and ceiling with a common tool; support, Unknown blocks, Liquids and falling blocks protected. Hand-held navigation turns it on through `excavate:true`, approach first tries the normal route.
- Status A* take into account the planned production and production of each branch: The removed block is not used as a future support; clearance limit — 32 block on route.
- Cooperative `planRouteAsync`: bounded slices, cancellation, optional world-revision check; native movement and collection yield during path searches.
- Bounded local timer cadence telemetry in `snapshot().metrics.timing` (not network ping).

- Fleet/peer coordination expanded to 20 clients with cost-based resource bids.
- Authoritative collection confirmation, pickup cancellation and target attribution fixes.
- Shield facing and cooldown handling, weapon restoration and safe critical-jump attempts.

- Lazy world registry; server recipe book indexed per output.
- Java 1.21/1.21.1 profiles and explicit capability queries.
- Predictive player avoidance and spectator handling; optional route edgeCost.
- Pillar/descent, End evidence, smooth ranged aiming.
- Smithing with authoritative inventory confirmation and preservation of components.

## 0.5.0 — 2026-09-30

- Self-published with source, by tests and MIT-licensing y9kudo.
- Anti-craft, Station installation, Smooth, Equipment and sleep.
- Swimming Eye, diagonal, sprint, The distance between players.
- `assessFall`, Total damage to the route and limitation of permissible falls.
- Portals, Observation of eye flight and maintenance of equipment during transition.
- Network list compatibility corrected 1.21.1.

### Foundation of the Library

- Player List, UUID and observed positions, `watchPlayer`, Priority attention and consideration of the head turns obtained.
- `lootChest`: chests, Double chests and barrels, Window server states, cancellation and confirmation of transfer.
- Selecting tool for block mechanics and exact slot; Correcting the selection of the damaged duplicate, accounting for recent strikes on one source.
- Separate package, version, Agent's contract and tests without any OvermindMC/Mineflayer.
- Offline-customer Java 1.21.1, world, equipment, execution, Interruption and Physics.
- Group 1–10 agents with English names, exchange JSON outside the chat room, of intention with TTL.
- Observations, Action history, User skills and protocol implemented/Physics.
- Cluster classes and properties, Nearest available wood of various species.
- Basic liquids, ice, mucus, honey, Web and ladders.
- Ballistics and bow shooting/Abbalette; A arrow flow is confirmed separately from impact.
- Actions `drop` and `eat` with the requirement for server change of inventory.

Game test: Alice/Blake and a group of seven clients connected simultaneously and agreed on intentions outside the chat room. The game's ten-track check is stopped by the server `server_full`; Library limit itself tested by automatic test. Special surface physics and firing are checked by model/protocol tests; A separate game test is still required.
