# OvermindMC migration and RL bridge — October 14, 2026

Author: **y9kudo**. Development version: **Version Arthas / 1.0.0-Arthas-dev.1**. These results describe bounded tests; they do not certify autonomous completion of Minecraft.

## Automated verification before translation

The full suite passed **523/523** tests after renaming the packages and adding PPO, discrete SAC, physical environments, the RL bridge and indexed resource queries. The suite includes:

- Numerical backprop checks against finite differences and contextual policy learning.
- On-policy revision rejection, model/optimizer restoration and corrupt-checkpoint rejection.
- Collision, liquids, fall damage, water landing, mob pursuit and shielding.
- 128 independent physical environments with two workers.
- Movement codec round trips for all 30 installed transport families.
- Stable view direction on a descending route, leaf-covered birch collection and protected structures.
- Reused section states, cache bounds, edit invalidation and legacy world heights.

Post-translation verification passed **527/527** tests. The language scan passed for all current source/documentation files. Strict TypeScript and clean installed-package checks also passed. [Structured evidence](overmind-migration-2026-10-14.json).

## Local physical training

| Policy | Transitions | Episodes | Training successes | Evaluation | Wall time | Process RSS snapshot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PPO | 12,800 | 1,179 | 1,160 | 32/32 | 0.791 s | 97.4 MiB |
| Discrete SAC | 19,200 | 717 | 605 | 32/32 | 1.157 s | 141.9 MiB |

Each run used 32 environments, at most two workers, a flat floor, no mobs, a fixed northward goal and random spawn offsets of at most 0.2 blocks. Evaluation used seeds 10000–10031. This tests a narrow geometric task; it does not establish generalization to caves or mobs. RSS is a process snapshot, not a measured peak for the whole computer.

Local evidence: `data/physical-ppo/report.json` and `data/physical-sac/report.json`. Checkpoints use `om-physical-v1` and `om-controls-v1`, with 18 input features and 9 actions.

## Live PPO transfer

Server: offline Java **1.21.1**, `127.0.0.1:25565`, Survival. Agent: **ArthasRL**.

The first attempt stopped before moving because a northward corridor was not safe. The revised bridge rotates the policy's observation/control frame and checks other cardinal corridors.

- Start: `(1.5, 99, −8.5)`.
- Goal: `(1.5, 99, −4.5)`, along the south axis.
- Final observed position: `(1.5, 99, −5.0567)`; the declared success radius is 0.8 blocks.
- 7 policy decisions, using ordinary sprint controls.
- Health: **20 → 20**; inventory remained empty.
- Server position corrections: **0**.
- Measured physics rate: **20.15 Hz** over 15 ticks.

No item-grant, teleport or world-edit commands were used. The native client's position was produced by physics and reconciled with server packets. Evidence: `data/rl-connect-live/report.json`.

The separate survival curriculum uses the symbolic resource controller. It must not be reported as a PPO-controlled survival run.

## Symbolic survival audit

`ArthasAudit` started with empty inventory and equipment on the same Java 1.21.1 Survival server. All six stages passed in **161.12 seconds**: logs by class, crafting table, wooden pickaxe, cobblestone, stone pickaxe and furnace. Health remained 20, there were zero server corrections, and 54 actions were recorded, including one failed pickup. No human interventions were recorded. Evidence: `data/overmind-live-audit/report.json`.

The most recent PPO replay ran north from `(1.5, 99, -5.0567)` to the success region around `(1.5, 99, -9.0567)`, again retaining 20 health and zero corrections. The local live report stores the most recent run; the southward result above describes the first successful transfer.

## Historical archive

The original `mckudo@0.1.0` tarball contains 23 files, MIT and author y9kudo. It was published byte for byte in [the archival branch](https://github.com/y9kudo/mckudo_core/tree/archive/mckudo-0.1.0). SHA-256: `1faf331e496af4ddca02e3ed7c64ba7080f3c82d54bd13d06c7c192cb4bc33ca`.

The original package refers to scripts/tests omitted from its tarball. Archiving it does not assert that it passes the current suite.
