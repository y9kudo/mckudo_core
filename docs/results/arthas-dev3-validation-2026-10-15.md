# Arthas dev.3 validation · 2026-10-15

Build: `1.0.0-Arthas-dev.3`. This record separates kernel checks, browser behavior and real Minecraft trials.

## Automated kernel and package checks

The regression suite passes **579 tests with no failures or skips**. It covers program validation, branch/repeat/until execution, progress restoration, mixed queue conversion, cancellation, failure attribution after defense, the eight-level nesting limit, authoritative actions, bounded 3D observations and texture/model import. Type declarations include the new program and vision APIs.

```powershell
npm.cmd test
npm.cmd run validate
npm.cmd run test:types
npm.cmd run check:english
npm.cmd run release:check
npm.cmd run test:package -- --offline
```

The package check installs both archives into a separate clean consumer and verifies public imports, program execution, locally served Three.js modules, optional Mineflayer, worker shutdown and package version consistency. Offline installation requires a populated npm cache.

## Browser checks

The dashboard was tested in headless Chrome with software WebGL at 1600 × 1050 and 390 × 844. The browser used an explicitly isolated fixture manager and registered Minecraft block states; it did not control a live agent.

Verified behavior:

- Add and nest blocks, edit repeat counts, switch between blocks and JSON, apply a validated document and export runnable JavaScript.
- Search connected-version item names, render actual client textures/models and display six colored route steps, a program waypoint, target, entity boxes and a protected region.
- Switch camera modes, drag back to orbit, ray-pick a rendered block and turn that selection into a navigation block.
- Keep the mobile document within the viewport, with no uncaught page errors or failed network requests during the scripted flow.

The asset importer was also exercised with an official Minecraft Java 1.21.1 client archive: **1,012 block textures, 2,137 models and 1,062 blockstate documents**. These game assets are local runtime data and are excluded from the project archives.

## Live Minecraft check

After the local server became available, **Liam** joined Java 1.21.1 Survival on `127.0.0.1:25565`. Through the browser UI, a six-block program was applied and started with an empty inventory. It gathered `#logs`, crafted a table, interleaved a resource goal with two finite waits, and satisfied its navigation goal. All program roots completed in approximately ten seconds; the final inventory contained a crafting table.

The real 3D response contained 1,550 exposed blocks, 13 palette entries, 1,012 local textures, one program waypoint and a three-step pickup route. That pickup approach was cancelled after collection was confirmed, so it is not counted as an executed waypoint route. A separate **range-zero** navigation trial then moved approximately 3.2 blocks to its exact destination cell and completed all three walking route steps. Both runs used normal client actions and the observed world.

The [curated live evidence](arthas-dev3-live-2026-10-15.json) preserves timestamps, program status, inventory, route status and the hashes of private raw reports. The agent was paused after testing. These bounded checks do not establish full-game autonomy. Earlier exact-version stone trials retain their original build identity in the [version lab](../VERSION-LAB.md); autonomous Dragon victory remains an open stable-release gate.

The publication candidate also checks Nether profile prerequisites and persistent exploration-distance completion in unit tests. A live from-zero Nether trial is launched after publication; it is not included among the already-passed gameplay results above.
