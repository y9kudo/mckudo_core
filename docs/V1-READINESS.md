# Arthas release acceptance

Target release: **1.0.0-Arthas**. The currently published package is **1.0.0-Arthas-beta1**. A new stable release has not been declared.

## Acceptance criteria

| Area | Required evidence |
| --- | --- |
| Autonomous campaign | Empty inventory and equipment in Survival; observed progression through Overworld, Nether and End; confirmed dragon death and the agent's own correlated damage |
| Fixed build | Final acceptance evaluates an identified build; diagnostic code changes and restarts remain disclosed development activity |
| Intervention accounting | Item grants, teleports, external assistance, deaths and recovery are recorded for review |
| Navigation | Dynamic terrain, protected edits, unknown chunks, bounded searches and route handoff are covered by contract regressions and relevant gameplay |
| Combat | Observed damage, projectile behavior, shield timing, cancellation and recovery are distinguished from sent attack packets |
| Packaging | Matching core/client versions; public imports, types, documentation links and clean consumer installation pass |
| Supported versions | Native gameplay support is stated separately from transport/catalog availability and experimental profiles |
| Public structure | Reusable APIs, current guides, examples and API tests; personal gameplay drivers and journals remain local |

## Current engineering work

The release preparation adds multi-goal spatial search, causal filtering for larger symbolic domains, section-scoped world invalidation, cached blocked-search results, observed home corridors and safe local ascent recovery. The local expedition monitor exposes campaign progress without creating another Minecraft connection.

These changes do not constitute proof of autonomous completion. The ongoing local campaign has a durable private journal so encountered failures can be fixed and investigated. Once a fixed build completes the acceptance run, review its evidence and rerun the package/CI gates before assigning the stable release name.

[Planning architecture](PLANNING.md) · [Application example](FULL-EXPEDITION.md) · [Quality policy and contributor checks](QUALITY.md).
