# Arthas beta1: navigation, combat and learning

OvermindMC is the decision library. OMConnect owns connection, observations and execution. OMVectorize supplies spatial algorithms. This update changes their shared execution boundary; applications still use the same goals and skills.

## Use the behavior

```js
await client.execute({
  skill: 'navigate',
  args: { x: 20, y: 64, z: -10, bridge: false, sprint: true }
});
await client.execute({
  skill: 'combat',
  args: { entityId: observedZombie.id, durationMs: 400, critical: true }
});
```

The target must be a current observed entity. A player target additionally requires `allowPlayer: true`. At kernel level, `createCombatReactor({ attackPlayers: true })` retains the default two-confirmed-hit retaliation policy. Trusted players remain excluded. These options are policy controls, not a permission to attack every player on a public server.

## Navigation execution

1. Plan on received terrain using bounded asynchronous A*. Unknown geometry is not traversable air.
2. Select a walking target within 16 blocks and at most 64 route steps. Never skip a jump, fall, dig or placement operation. Corner shortcuts require clear space for the complete footprint and full support. Learned detours are preserved when a navigation policy is attached.
3. Keep ordinary physics velocity across compatible walking spans. Brake for vertical transitions, block edits and arrival. Sprint and sprint-jump still require hunger, heading and verified clearance.
4. Check changing support and nearby players while moving. The executor does not wait for a server position acknowledgment at every waypoint. It does honor corrections, teleports, block updates and inventory results.

`createNavigationGoal` can hand its route to the same client. The internal token is single-use, expires after two seconds and is held in a per-client cache of at most four entries. Start, goal, options, dimension, inventory revision, protection revision, learned policy, corrections and the observed read view must still match. An invalid handoff falls back to a new search; callers cannot submit arbitrary serialized paths as trusted plans.

## Combat execution

The controller evaluates a frame every 25 ms when the event loop is available. This is a scheduling target, not a network latency guarantee or extra Minecraft physics ticks; movement remains on the ordinary 20 Hz loop.

- Measure reach from the eye to the target's body, including known player poses and baby scaling. Require the actual look ray to intersect the body and test voxel occlusion before a strike.
- Charge the selected weapon instead of sending repeated weak attacks. Base sword/axe mechanics currently target Java 1.21.1; enchantments, effects and custom attributes are not a full damage simulator.
- Consider a facing shield when selecting an axe. Avoid unintended sword sweep damage around other players.
- Face a threatening projectile when guarding. Release the shield when retreat or an attack opportunity takes priority. Respect server-supplied shield cooldowns.
- Attempt a critical jump only with health, food and checked surrounding headroom/support. Wait for the descending phase without sprinting; water/climbing suppress those opportunities.
- Reconsider unreachable pursuits. A sent attack is not evidence of damage; only an attributed damage event refreshes successful combat progress.
- Always release controls, shield state and temporary listeners on cancellation or failure.

### Ranged tracking and tactical follow-up

Target velocity is measured from received position snapshots in blocks per game tick. Knockback/spawn velocity packets remain available unchanged; they are not treated as permanent walking velocity. The estimator coalesces TCP bursts, decays stale motion, resets after teleports/outliers and uses entity-object identity so reused IDs do not inherit movement. These are local predictions, not knowledge of a player's future inputs.

Bow and crossbow actions update the interception solution throughout charging and alignment. The ordinary smooth-look controller receives bounded angular feed-forward; the actual current angles must still be within a distance-dependent tolerance before release. A player jump forecast uses gravity and known landing surfaces. Unknown terrain can still block a trajectory. `solveAim` also accepts an optional pure `predictTarget(ticks)` callback; the default remains linear interception.

The selected sword/axe is retained for its base cooldown plus 175 ms after a switch. Repeated enemy shield toggles therefore cannot prevent a charged attempt forever. Shield-facing geometry chooses a persistent orbit direction; cooldown movement maintains spacing, and guarded movement remains slowed. Critical jumps require a close, non-receding target and verified support/headroom. These adjustments still obey ordinary movement physics, reach and collision checks.

At core level, distant visible threats with arrows may select `shoot`. `ranged: false` disables this choice; `rangedDistance` defaults to eight blocks. A facing enemy shield suppresses this choice in favor of approach. A closing opponent, low health or a newly raised facing shield cancels a tactical draw by switching slots. A failed shot backs off ranged selection for 1.5 seconds while approach/defense remain available. It does not count as a hit.

Inspect `client.aimDebug` for measured velocity, motion confidence/age, predicted intercept, flight time, current angular error and release tolerance. `client.combatDebug` also includes the held weapon and its commitment deadline. That deadline uses the local monotonic clock and is not an epoch timestamp.

### Independent projectile defense

`createCombatReactor` selects a priority-1000 reactive guard when a shield is available and a projectile is predicted to intersect the agent's moving body. This defensive reaction does not require two previous hits or `attackPlayers: true`, and never authorizes attacking the shooter. Incoming projectiles and observed aimed bow draws wake urgent observation even during another action; a lower-priority bow draw is cancelled before the offhand shield is used.

The defensive read view advances sparse arrow snapshots with drag, gravity and observed collision geometry. It leaves received entity state unchanged, ignores the agent's own arrows and stationary projectiles, and expires old unobserved motion. A wall can invalidate the predicted threat. Guarding follows the projectile/shooter, respects shield cooldowns and releases after 125 ms without a remaining threat, cancellation or its bounded two-second budget. No repeated raise packets are sent inside that action.

Java's shield has a five-tick activation delay, approximately 250 ms at 20 TPS. Seeing a very close arrow only after release cannot guarantee a block. Observed use of an aimed bow provides advance warning; unexpected shots from behind can still arrive before turning/activation completes. `client.shieldDebug.estimatedActiveAt` is a local estimate, not a server acknowledgment. The `shieldBlock` event is emitted only for the server's shield-block entity status and does not identify which projectile was blocked.

Inspect `client.combatDebug` for target, mode, reason, measured reach and visibility. `client.navigationDebug` describes the active route, and `client.metrics.routePlansReused` counts accepted kernel handoffs. Applications should present these as observations and scheduling decisions, not proof of a successful hit or a guaranteed route.

## Learning memory migration

Schema two keys local failure memory by dimension, origin, destination and movement kind. A failed northern approach does not prohibit a successful western approach to the same block. Cancelled actions, occupancy, stale plans, corrections and changed support do not label a movement skill as a learned failure. Schema-one network weights, counters and replay data are retained, while overly broad destination bans are discarded. An attached learned policy composes with existing application route costs and restores them on detach. The small local network predicts transition risk; it is not a generally trained Minecraft reasoning model.

## Critical audit and remaining acceptance work

| Finding | Change or required evidence |
| --- | --- |
| Stop-and-wait at every executed span | Compatible walking spans retain velocity; regression test verifies a long route without position acknowledgments |
| Kernel route searched again by client | Validated one-use route handoff; invalidation tests cover state changes |
| Guard/aim waits hide new tactical information | Dedicated continuous combat controller; tests change health and target position inside a frame |
| Repeated attack packets counted as progress | Pursuit now requires actual damage evidence to extend its full encounter budget |
| Close targets bypassed every failure backoff | Immediate retry is restricted to transient aim failures; blocked pursuits can yield to another threat |
| Failure memory poisoned an entire destination | Directed transition memory and migration tests |
| LAN login could stall during configuration | Common ping receives pong before world readiness; live entry verified |
| Search geometry and physics differ for partial shapes | A unified traversal model for slabs, stairs, doors and fluid boundaries is still needed |
| Native acceleration covers only a subset of routes | Learned costs, excavation and bridges still need their supported fallback; measure complete decision latency rather than claiming a kernel benchmark is whole-agent speed |
| General intelligence and release claims exceed evidence | Keep separate goals for observed progress, actual item acquisition, self-supplied equipment and an own Dragon kill. The empty-inventory full-game acceptance run remains incomplete |
| PvP result depends on gear, terrain, effects and server behavior | Run controlled arena trials with health/damage records and identical loadouts before claiming a win rate or competitor parity |
| Long action waits can resemble slow reasoning | Profile observation, search, physics and server-confirmed action time separately. In particular, reproduce the previous furnace timeout with an instrumented container trace |

## Reproduce checks

```powershell
npm.cmd run check
npm.cmd run test:types
npm.cmd run release:check
npm.cmd run test:package
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_VERSION='1.21.1'
npm.cmd run test:live:beta1
```

The bounded live probe logs in, finds a supported short route, executes a kernel-planned outbound and return trip, records route reuse/cadence/corrections and disconnects. It does not issue world-edit commands or grant equipment. Its JSON report is saved locally to `data/beta1-live.json`.

For a manual local duel, run `node examples/pvp-duel-live.js`. Defaults are `127.0.0.1:25565`, Java 1.21.1 offline, agent `RowanDuel` and opponent `y9kudo`; override `MC_HOST`, `MC_PORT`, `MC_NAME` and `MC_OPPONENT` as needed. Supply diamond armor and a sword/axe; a shield, bow and arrows enable those options. Once equipped and healthy, the agent waits for two fresh attributed hits. It stops fighting after a death and remains connected for inspection. Write `{"command":"stop"}` to `data/pvp-duel-control.json` to disconnect. Equipment, fighting and pickup behavior come from library policies, not scenario-specific combat code.

The local report `data/pvp-duel-live.json` separates sent melee attacks, attributed outgoing damage, accepted shots and attributed arrow damage. It retains up to 600 motion/aim snapshots at 100 ms intervals and 2,000 events. These local files are ignored by Git. A manual duel is useful for discovering bugs; varying gear, regeneration and human input do not establish a controlled win rate. See the [tracking follow-up report](results/arthas-beta1-pvp-tracking-2026-10-15.md) for the measured results and the initial ownership-counter defect.

## Research sources

- [Minecraft: Taking Inventory — Sword](https://www.minecraft.net/en-us/article/taking-inventory--sword): charged attacks and Java sweep behavior.
- [Minecraft: Taking Inventory — Shield](https://www.minecraft.net/en-us/article/taking-inventory--shield): front-facing defense, movement slowdown and vulnerability to axes.
- [Baritone upstream feature documentation](https://github.com/cabaletta/baritone/blob/1.21.4/FEATURES.md): segmented navigation and route continuity informed the architectural review. The implementation here is independent; no upstream source was copied.
- [PrismarineJS protocol definitions](https://github.com/PrismarineJS/minecraft-data/tree/master/data/pc/1.21.1): separate common ping/pong and keep-alive packets.
- [Craig Reynolds: Steering Behaviors for Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/): separating tactical selection from pursuit, evasion and locomotion.
- [Glenn Fiedler: Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/): handling network snapshots and their temporal limits. Aim here extrapolates received observations rather than delaying them for display interpolation.

These sources explain mechanics and design decisions. They are not evidence that this beta matches another project's complete navigation behavior.
