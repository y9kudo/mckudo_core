# Agent Center · Arthas dev.3

The local dashboard connects agents, edits their programs and displays live observations. Start it from the project root with `npm.cmd run dashboard`, then open http://127.0.0.1:4180. Node.js 24 is recommended.

## Connection settings

Set these environment variables **before** starting the dashboard:

```powershell
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_VERSION='1.21.1'
$env:MC_WORLD='survival-world-a'
$env:MC_DASHBOARD_PORT='4180'
npm.cmd run dashboard
```

The default fleet contains Owen, Liam and Noah. Connect only the agents you need. The default client uses offline authentication and requires a server configured to permit it. `MC_WORLD` partitions task and learning memory; use a different value for a different world. Native gameplay profiles cover Java 1.21/1.21.1; see the [version API](VERSION-API.md) for explicit experimental profiles.

## Program builder

1. Select an agent and press **Connect**.
2. Load **First tools & furnace** to get a working resource-goal example. Alternatively, add blocks from the palette.
3. Select a block to edit its inputs. **Gather resources** accepts item counts and classes such as `#logs`. After login, its item fields offer searchable names from the connected version's catalog. The kernel plans tools, stations and other prerequisites.
4. Drag blocks to reorder or nest them. Use arrow buttons for ordinary reordering. An if block has separate **WHEN TRUE** and **OTHERWISE** drop areas.
5. Press **Apply program**. This pauses the old work, validates the new document and resets its execution state. Press **Start program** to run it. Starting a changed draft applies it first.

**JSON** edits the same document as the block editor. **JavaScript** displays an application generated from the document; export it to edit and run it in VS Code. The web server accepts validated program data and registered actions. It does not evaluate uploaded JavaScript. [Program reference](PROGRAMS.md).

Execution state and reasons appear above the editor and beside individual blocks. Three consecutive failures of the same program leaf fail that leaf. Pause before changing a program; **Retry** restarts its controller, while applying the document resets all of its task state. Saved programs and model memory are stored under `data/agents/`, partitioned by world and agent name.

## Live 3D vision

Open **3D vision** after connecting an agent. The view renders the block states actually decoded from received Minecraft chunks. Unloaded terrain remains empty; it is not filled with guessed ground. The selected horizontal radius is 4–24 blocks, with independently adjustable vertical extent of 1–24 blocks above and below the agent. A snapshot is capped at 12,000 exposed blocks, with a visible capped indicator. Large volumes can take longer to scan.

World snapshots refresh up to twice per second while this tab is visible. Browser rendering interpolates agent movement between snapshots. The snapshot-age indicator exposes stale data. Inactive views stop rendering and stop requesting 3D snapshots.

| Control or overlay | Meaning |
| --- | --- |
| Drag / scroll | Orbit the camera / change zoom |
| Shift + drag | Pan around the selected agent |
| Follow agent | Third-person camera following the agent |
| Agent eyes | Camera placed at the agent's eye position and yaw/pitch |
| View frustum | Approximate viewing direction and camera field of view |
| Colored route | Actual OMConnect route: walk, jump, descent, bridge or excavation |
| Diamond markers | Program waypoints and the current action/navigation target |
| Entity boxes | Observed players and entities, represented by debug geometry |
| Pink boxes | Explicit protected regions |
| Click a block | Inspect exact coordinates, block identity and state properties |

**Waypoint above selected block** adds a movement block to the program draft at the selected block's X/Z and Y + 1. Review the destination before applying it. The navigation executor still checks reachability, support, occupancy and protection. A preview marker does not override these checks.

The preview is a spatial debugger of observations. Entity boxes are not animated Minecraft skins; biome tint and animated texture sheets use a simplified display, and unsupported block models fall back to their available geometry/color. These display limitations do not modify the agent's world or physics.

## Load Minecraft textures and block models

The project does not redistribute Minecraft textures. The dashboard reads them locally from a client JAR or a resource pack ZIP:

```powershell
$env:MC_TEXTURE_PACK="$env:APPDATA\.minecraft\versions\1.21.1\1.21.1.jar"
npm.cmd run dashboard
```

When launched normally under your account, the launcher also checks the installed client JAR for the selected version. If it cannot find one, select an archive in **3D vision → Minecraft textures → Load textures**. A **server JAR** usually has no block textures; use the **client JAR** under `.minecraft/versions/` or a resource pack containing `assets/minecraft/`.

The importer reads block PNGs, model JSON and blockstate JSON. It resolves model parents, texture aliases, blockstate variants and multipart selections in memory. Archives are limited to 128 MiB; selected decompressed assets are limited to 64 MiB. Archive paths are never extracted to the filesystem. Texture PNGs are available only from the dashboard's loopback server. Uploaded assets disappear when the dashboard closes; set `MC_TEXTURE_PACK` to load them again on startup.

## Other tools

- **Inventory:** observed item slots and equipped armor.
- **Planning & learning:** resource prerequisites, local training samples, updates and action outcomes.
- **Controls:** view-distance request, idle-gaze settings, survival profiles, gifts and a registered OMConnect action in JSON.
- **Diagnostics:** phase timing metrics and the latest 256 dashboard-captured state changes. This replay records state changes rather than a complete Minecraft world recording.
- **Schematics:** import supported structure files and execute another bounded batch of physical placement actions.

The server binds to `127.0.0.1`. Mutating requests require the current session token and pass Host/Origin checks. Keep authentication caches, local worlds, assets and memory directories private. The dashboard does not provide a remote shell or arbitrary file-path API.
