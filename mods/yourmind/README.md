# YourMind for Fabric 1.21.1

**By y9kudo · MIT · client mod `0.1.0-dev.1` · part of the OvermindMC repository**

YourMind controls your existing Minecraft player through normal movement keys and vanilla interactions. It runs inside the Minecraft Java client. It does not log in a second account, start an OMConnect bot, or require a Node.js process. Single-player and multiplayer use the same commands. Install the mod on the client, not a dedicated server.

This is the first Java implementation of the platform's client-side execution concepts. The JavaScript OvermindMC brain and OMConnect remain separate, working packages. YourMind does not yet embed their full survival, combat, learning, fleet, dashboard, schematic or expedition systems. Its Java ground planner is an independently written OMVectorize implementation, not a bundled Baritone binary.

## Install the mod

1. Install Minecraft Java **1.21.1**, [Fabric Loader](https://fabricmc.net/use/installer/) **0.16.14 or newer**, and the **1.21.1** build of [Fabric API](https://modrinth.com/mod/fabric-api/versions?g=1.21.1).
2. Build the project below, or obtain `yourmind.jar` from a successful **YourMind Fabric** workflow artifact for the exact source commit you want to test.
3. Copy `yourmind.jar` and the Fabric API JAR into your launcher's `mods` folder. Remove older copies of YourMind.
4. Launch the Fabric 1.21.1 profile and join a world. Back up a test world before trying resource jobs.
5. Send `#help` in chat. These commands are intercepted locally; they are not broadcast to other players. `/yourmind help` is an alternative prefix if another mod uses `#`.

The mod operates the player you are logged in as. Press **End** at any time to stop its current job; rebind this in Minecraft Controls. `#pause` releases movement and mining controls. Open a normal game menu to suspend execution while you inspect things.

## Commands

| Command | Meaning |
| --- | --- |
| `#goto 24 64 -12` | Follow collision-safe ground segments to an exact block position |
| `#mine #minecraft:logs 8` | Mine up to eight matching blocks across available wood species, then collect drops |
| `#mine minecraft:iron_ore 4` | Mine matching observed blocks with a suitable existing tool |
| `#get minecraft:crafting_table 1` | Reach a total inventory target using observed natural block sources and server crafting recipes |
| `#get minecraft:stone_pickaxe 1` | Plan crafting prerequisites, create a required wooden mining tool, place/open a crafting table, and check inventory |
| `#farm 16` | Harvest mature wheat, carrots, potatoes or beetroot within 16 blocks and replant using an existing seed |
| `#status` | Show job, route progress, search duration, node count and loaded recipe count |
| `#pause` / `#resume` | Pause or refresh the current job after resolving an obstruction |
| `#stop` | Cancel the job and pending route calculation |
| `#help` | Display the command reference |

Counts are bounded to 1–4096. Farm radius is 2–24. A job has a ten-minute budget and pauses on low health, repeated movement failures or missing confirmation. A death or dimension change stops the job. Resource collection never counts an action timer as proof that an item was obtained.

`#mine` selects blocks you explicitly request; it does not craft a missing mining tool. `#get` recursively plans **crafting-table and inventory recipes** supplied by the joined server. Observed natural sources determine which wood species can be collected. It does not currently execute furnace, brewing, smithing or mod-machine recipes. A locked recipe, unavailable dependency or unsupported machine produces an explicit paused state.

Farming needs a walkable approach and an existing seed for each crop before harvesting. It does not create new farmland or animal farms. Protected claims and permissions are ultimately enforced by the server. Ground routes do not excavate buildings or place bridges automatically. Explicit mining commands can modify blocks matching your selector, so use a dedicated test area.

## Open and build in VS Code

Install **JDK 21**, Visual Studio Code and its **Extension Pack for Java** and **Gradle for Java** extensions. Open this folder (`mods/yourmind`) as a VS Code project. The recommended extensions are included in `.vscode/extensions.json`.

Windows PowerShell:

```powershell
java -version
.\gradlew.bat build
```

Linux/macOS:

```sh
sh ./gradlew build
```

The wrapper uses Gradle 8.12.1 with a pinned distribution SHA-256. JDK 8 cannot compile this mod. If your PATH still selects Java 8, set `JAVA_HOME` to your JDK 21 directory for the terminal session before running Gradle.

Outputs:

- `build/install/yourmind.jar`: remapped installable mod.
- `build/libs/yourmind-0.1.0-dev.1.jar`: the same remapped mod with a versioned filename.
- `build/libs/*-dev.jar`: development mappings; **do not install this file** into a normal Minecraft profile.
- `build/reports/tests/test/index.html`: Java unit-test report.

Run a development client with `gradlew.bat runClient`. This opens a separate development game instance. It does not reuse your Microsoft session or automatically join the user's running world. Use your normal authenticated launcher to test the built mod in your usual client.

MCreator is a different project format with loader generators. This folder is a standard Fabric Gradle project; it should be opened in VS Code or IntelliJ IDEA, not imported as a fabricated `.mcreator` workspace. Fabric Loom resolves the exact Minecraft mappings and API used by the source.

## Code map

| File | Responsibility |
| --- | --- |
| `YourMindClient.java` | Fabric lifecycle, local chat/client commands, emergency key |
| `AgentController.java` | Job state, result checks, inventories, mining, loot, crop and crafting actions |
| `TerrainCapture.java` | Main-thread world reads, bounded two-millisecond slices, collision classification |
| `MotionController.java` | Smooth view changes and ordinary movement/sprint/jump inputs |
| `RecipeCatalog.java` | Server recipe import and natural resource-to-block associations |
| `core/RoutePlanner.java` | Standalone Java A*, diagonals, headroom, steps, safe descents and useful partial segments |
| `core/VoxelGrid.java` | Immutable compact collision grid for worker input |
| `core/ResourcePlanner.java` | Bounded recursive crafting dependencies and ingredient alternatives |
| `core/Command.java` | Validated commands usable by chat or Java integrations |

Route work uses one daemon worker and at most one pending search. Game objects never enter that worker. World reads and interaction calls remain on Minecraft's client thread. Route terrain is checked again before each movement step. Cancelled tasks discard their route future; disconnected worlds discard their recipes and terrain.

The current ground model supports known, dry full-block surfaces, one-block jumps, conservative descents of at most three blocks and diagonals with corner clearance. It treats unknown space, fluids, hazards and unsupported partial-block geometry as non-traversable. It does not yet perform swimming, creative flight, elytra flight, parkour gaps, excavation, bridge placement or Nether/End expedition planning inside the Java mod. These are explicit extension points, not commands silently delegated to a nonexistent backend.

## Validate in a test world

1. Use a flat 1.21.1 Survival world with nearby mixed tree species. Start with an empty inventory. Run `#get minecraft:crafting_table 1`; inspect resource species, visible arm swings, dropped-item pickup and the actual inventory.
2. Run `#get minecraft:wooden_pickaxe 1`, then `#get minecraft:stone_pickaxe 1` with reachable exposed stone. Check the placed table, tool switches and server-confirmed craft output.
3. Place a solid wall and a pit between the player and a goal. Use `#goto`. Confirm it chooses a known safe path or pauses without walking into unknown space.
4. Plant mature crops beside a solid walkway and carry seeds. Use `#farm 8`. Confirm harvesting, replanting and collected items.
5. During each task, press End; then test pause/resume, opening a menu, disconnecting and changing dimension.

Java tests cover collision geometry, corner clearance, headroom, unknown voxels, voids, route cancellation/budgets, recipe cycles, alternative wood sources, ingredient accounting and command validation. A successful compile/test run is not a recorded live Minecraft result. Live-client verification must be recorded separately with the source commit and observations.

`gradlew.bat benchmarkNavigation` runs a fixed-fixture JVM benchmark with warmup and median/p95/p99 measurements. It does not start Minecraft. See [computation boundaries](../../docs/POLYGLOT-RUNTIME.md) for JavaScript/C/Java responsibilities and the measured C search benefit.

## Design references

Fabric's [Loom documentation](https://docs.fabricmc.net/develop/loom/) and [1.21.1 Yarn API](https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/) define the integration surface. Baritone's published [feature description](https://github.com/cabaletta/baritone/blob/master/FEATURES.md) is a useful comparison for segmented pathing and action costs. No Baritone source code or binary is included. Its [LGPL-3.0 license](https://github.com/cabaletta/baritone/blob/master/LICENSE) remains separate from this implementation's MIT license.
