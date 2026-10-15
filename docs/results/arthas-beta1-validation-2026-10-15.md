# Arthas beta1 verification — October 15, 2026

Version: **1.0.0-Arthas-beta1**. Created by **y9kudo**.

## Real-server evidence

A local Java **1.21.1** LAN world was used. Offline authentication, one agent at a time, no granted items, administrative commands or world edits were used by the probe.

The initial login attempt failed before receiving a game session. A bounded protocol trace reached configuration `ping` and then stalled. After adding common ping/pong handling, the same server admitted OMConnect and the movement probe passed.

The dedicated `npm.cmd run test:live:beta1` probe then completed:

| Stage or metric | Observed result |
| --- | --- |
| Login and world readiness | Passed |
| Kernel-planned outbound trip | Passed, 8 route steps, approximately 2.80 seconds |
| Kernel-planned return trip | Passed, 14 route steps |
| Accepted one-use route handoffs | 2 |
| Server position corrections during movement | 0 |
| Final health | 20 |
| Recent local physics cadence | 20.03 Hz |
| P95 local tick interval | 62.38 ms |
| Ticks delayed beyond 75 ms in the recent window | 0 |
| Maximum measured physics callback | 1.93 ms |

The return route had more steps because the planner selected a different supported path through the observed terrain. A second run after the final navigation review also passed: two route handoffs, zero corrections, health 20 and 19.99 Hz local cadence. These metrics describe short trials, not a server ping measurement or a global speedup claim. Local raw reports are kept in ignored `data/`; this document is the curated publishable record.

## Automated checks

`npm.cmd run check` passed **596 tests**, with zero failures, skips or cancellations on Windows / Node.js 24.19.0. This includes **17 added regression cases** beyond the previous 579-test baseline.

The added scenarios cover reach and look-ray geometry, opaque obstacles, moving targets, shield facing and release after health changes, cancellation cleanup, charged attack cadence, unconfirmed attacks, continuous movement, unsupported corners, corrections, route handoff invalidation, common ping/pong, directed learning-memory migration and composition with an application's existing route costs.

Strict public TypeScript checks, the English text check, package version/content/link validation and an offline consumer installation of both archives passed. The consumer imports both packages without Mineflayer and checks lazy data loading, mission execution, memory, CPU-worker execution and shutdown.

The optional compiled C kernel was required explicitly with `OM_REQUIRE_NATIVE=1`; all eight native checks passed, including the real C wire codec, ground A*, bounded asynchronous routes and dense inference.

## Boundaries

No controlled live PvP match or equipped PvE encounter was run in this trial. Combat changes are covered by automated protocol and physics fixtures. No complete empty-inventory Dragon victory, broad-version movement equivalence or comparative navigation benchmark was established. These remain separate acceptance tests before stable 1.0.0.
