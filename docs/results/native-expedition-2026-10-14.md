# Native C and resumed Survival evidence — October 14, 2026

This records development checks for `1.0.0-Arthas-dev.1`. It does not certify a stable release or a completed Minecraft campaign.

## Automated checks

Windows x64, Node 24.19.0: **561/561 tests passed**, including eight checks that required an actual compiled C addon. TypeScript consumers, English text, release source allowlists and an offline installation-archive consumer also passed. The C binary was rebuilt from current sources using TinyCC 0.9.27's shared-library API. Local toolchains and binaries are not distributed in Git or source installation archives.

Native checks cover 32 static geometry fixtures against the JS route cost, diagonal clearance, hazards, falls, input copying, cancellation/revision rejection, overload, worker shutdown, packet fragmentation, signed VarInts and dense inference. Linux Node 22/24 native compilation is configured in CI; its remote result is separate from these local Windows checks.

## Search benchmark

`examples/native-benchmark.js` used a 48 × 6 × 48 known-voxel fixture with a wall opening, eight warmups and 40 measured samples per implementation. Both implementations returned cost `63.69848480983497`.

| Measurement | JS | C |
| --- | --- | --- |
| Median search | 9.0082 ms | 1.9207 ms |
| p95 search | 12.3722 ms | 2.3853 ms |

The first adapter call, including capture, took 7.8376 ms. The roughly 4.7-fold median difference applies to this prepacked search fixture, not the full client, an agent's entire decision loop or Minecraft server latency. Results vary with load, compiler and terrain.

## Live controlled Survival campaign

- Java 1.21.1, offline Survival, normal difficulty, localhost port 25566; existing world retained across the computer restart.
- `ArthasC01` resumed its original empty-inventory campaign and restored checkpoint and learning memory. Abrupt interruption is retained as a separate journal segment.
- C framing actually handled login, configuration, chunks and play packets. Static C routes executed; excavation and other unsupported cases used the existing JS planner. Counter values reset per process and remain in segment reports.
- The agent selected birch through the log class, collected drops, climbed out of a deep cave by opening supported steps, crafted a workstation, stone pickaxe, furnace and stone sword, and completed `stone-tools` before proceeding to `early-shield`.
- Planning-risk weights changed through recorded online updates. Navigation learning was deliberately detached for this C-routing profile; this run does not demonstrate PPO/SAC driving a complete expedition or C training the risk network.

Failures exposed and addressed included irreversible starter cave descents, walking toward occluded blocks, workstation lookup across different cave levels, unexpected interactive-support menus, erased ownership after duplicate packets, and lost ownership during furnace lighting updates. Food, ownership, placement and recovery policies have targeted regressions.

One lost workstation ownership record was repaired in saved client memory from controlled-run placement/terrain evidence and explicitly logged as an intervention requiring review. No inventory items, world blocks, positions or game modes were granted or replaced by that repair. **This diagnostic continuation cannot be presented as an unassisted stable-release run.** A fresh campaign on the corrected implementation is needed for that claim.

The campaign is still incomplete: no confirmed Nether-to-End traversal or own Dragon victory is reported here. Runtime journals, memory and worlds remain private local data. See [launch and evidence instructions](../FULL-EXPEDITION.md) and [native build documentation](../NATIVE-COMPUTE.md).
