# Quality and release policy

OvermindMC is a library and independent Minecraft client. Public source contains reusable APIs, examples, unit/contract tests and CI configuration. Personal game trials, race drivers, temporary diagnostics and session journals belong in ignored local QA workspaces.

## Checks for contributors

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:types
npm.cmd run check:english
npm.cmd run release:check
npm.cmd run test:package
```

CI covers Linux/Windows on Node.js 22/24. Linux additionally builds and requires the optional C kernel. Package checks install archives into a separate consumer, resolve public imports, validate versions and links, and reject runtime/private paths. Offline consumer checks require a populated npm cache.

Tests verify contracts and regressions; their count alone is not a gameplay success metric. Protocol availability, observed gameplay support and successful autonomous objectives are distinct claims.

## Local operational data

Keep worlds, credentials, texture archives, player traces, training checkpoints and detailed reports under ignored runtime paths. The local expedition monitor reads one configured report and exposes a bounded summary on loopback. It does not connect another Minecraft account or expose a file browser.

Before sharing a bug report, describe the exact version, objective, expected result and minimal observed failure. Share a small sanitized reproducer rather than an entire world or player journal.

## Arthas acceptance

Stable Arthas requires an empty-inventory Survival campaign ending with server evidence of an Ender Dragon defeat and the agent's own correlated damage. Item grants, teleports, diagnostic restarts, deaths and other assistance must be disclosed during review. A prepared End fight or a simulated campaign is insufficient.

Engineering runs can continue across fixes, but the final acceptance should evaluate a fixed build. Preserve evidence locally for review; the public release description should summarize scope and known limitations without publishing personal journals. The release name and status change only after acceptance and package/CI checks pass.
