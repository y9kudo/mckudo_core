# Arthas beta1: PvP tactics and projectile tracking follow-up

Date: 2026-10-15. Windows, Node.js 24.19.0, local Java 1.21.1 offline world.

## Problems reproduced

- Walking player velocity was not derived from position packets. A spawn/knockback velocity could remain stale while aiming.
- Bow charging waited without following the target. The final smooth-look waits repeatedly chased obsolete positions.
- Shield toggling could repeatedly switch sword/axe and restart their cooldowns.
- A failed ranged aim suppressed the opponent rather than allowing an immediate melee approach.
- Native 1.21 projectile spawn ownership was decoded with the offset used by damage-event optional entity IDs. The native spawn field carries the owner's actual ID.
- The duel harness mistook a dead login for a new round's death. It now distinguishes preparation from an armed match.

## Implemented changes

Target motion is estimated from position snapshots with burst coalescing, stale-data decay and teleport resets. Charging and alignment follow fresh interception solutions, with bounded angular feed-forward into ordinary smooth look. Jump forecasts integrate gravity and stop at observed landing surfaces. Ordinary look-ray accuracy is checked before release; releasing a projectile never claims a hit.

Weapon commitment lasts for the selected weapon's base cooldown plus 175 ms. Combat uses directional shield flanks, cooldown spacing, guarded movement and more selective critical jumps. Existing full-footprint support, collision and reach checks remain in force. The core avoids shooting a facing shield; an opponent raising one during a tactical draw cancels the shot without releasing the arrow.

Ranged failures back off shooting for 1.5 seconds while keeping approach/defense available. Damage observations preserve the direct projectile ID separately from its attributed shooter. The example retains a bounded local motion/aim trace and records projectile release separately from damage.

## Live development round

The user supplied diamond armor, sword, axe, shield, bow and arrows. The updated tracking/tactics controller participated in a manual round as `RowanDuel`. The round ended with the agent's death; this is not a winning PvP acceptance result.

| Recorded metric | Result |
| --- | --- |
| Sent melee attack packets | 191 |
| Attributed outgoing damage events, all weapon types | 196 |
| Attributed incoming damage events | 152 |
| Server-confirmed projectile/ammunition uses | 41 |
| Sent weapon attempts / accepted shots | Sword 185; axe 6; bow 41 |

Outgoing damage events are not identical to sent melee packets. Gear durability, food, regeneration and human behavior varied during the round. The initial arrow-only damage counter was affected by the ownership decoding defect above; **do not derive arrow accuracy from this round's counter**. The ownership correction and shield-aware draw cancellation were subsequently checked in protocol/action fixtures, not in another live round. The server later closed the connection. No new match was started after the user asked to leave the agent waiting.

## Recorded-motion prediction check

The local report retained the final 600 motion snapshots at approximately 100 ms intervals. For each moving target sample with a subsequent observation, a 200 ms position forecast was compared against an interpolation of the later observed positions. This measures short-horizon prediction error, **not arrow hit rate**. A flat floor at the observed ground level was assumed for vertical forecasts because the motion trace does not contain a terrain replay. No future player inputs were supplied.

| Sample subset | Count | Mean forecast error | Mean error when aiming at the unchanged observed position |
| --- | --- | --- | --- |
| Moving targets at all recorded ranges | 227 | 0.614 blocks | 0.900 blocks |
| Moving targets 8–24 blocks away | 12 | 0.419 blocks | 1.282 blocks |

All 12 ranged samples improved, but this is a small, selected window from one manual encounter. Direction reversals and knockback still produce large errors in some close-range samples. No general accuracy, win rate or competitor comparison follows from these numbers.

## Automated verification

`npm.cmd run check` passes 618 tests with zero failures, skips or cancellations. Focused additions cover protocol-to-estimator wiring, position-only motion, packet bursts, stops, teleports, entity-ID reuse, jumping interception with independent projectile integration, smooth yaw-wrap tracking, shield flicker through a real executor cooldown, safe spacing near edges, moving-target charging, shield-aware cancellation and core fallback after ranged failure.

After the user reported late arrow defense, an independent priority-1000 reactive guard was added. Seven additional scenarios cover predicted body intersections, own/missing arrows, walls, pre-release bow warnings, sparse projectile updates, release after danger/cancellation/cooldown and actual core preemption of an ongoing bow draw. These are protocol/physics fixtures; the new defensive controller has not yet been confirmed blocking arrows in another live match. The five-tick shield activation delay remains part of the mechanics.

Strict TypeScript checks and offline consumer installation checks pass. The package consumer verifies imports, optional Mineflayer integration, lazy registries, missions, memory, CPU workers and shutdown. Raw duel logs, player motion and runtime state remain ignored local data. Reproduction commands and duel setup are documented in [the combat guide](../BETA1-NAVIGATION-COMBAT.md).

Stable 1.0.0 still requires its independent full-game acceptance run. This follow-up does not establish autonomous Dragon completion or broad-version combat equivalence.
