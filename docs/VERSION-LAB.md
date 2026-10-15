# Minecraft Java version lab

This lab checks **actual server behavior**. `known` means the installed registry recognizes a release; `transport` means a wire codec exists; `ready` means the client joined and decoded its world; `stone` means an agent starting with an empty inventory collected cobblestone from natural stone. These are different results.

The server list is selected from milestones in Java multiplayer and world/protocol changes. Passing one milestone does not prove that every intervening release works. For each additional release, run the exact-version trial and keep its report before marking it tested. The complete release list can be discovered with the [version API](VERSION-API.md).

## Recorded local trials · 2026-10-15

| Version | Empty inventory | Last confirmed stage | Result |
| --- | --- | --- | --- |
| 1.8.8 | Yes | Gather logs | Incomplete: disconnected before the crafting-table stage finished |
| 1.12.2 | Not tested | Server archive prepared | No gameplay claim |
| 1.16.5 | Yes | Gather logs | Incomplete: inventory confirmation timed out during table crafting |
| 1.18.2 | Not tested | Server archive prepared | No gameplay claim |
| 1.20.4 | Yes | Logs → table → wooden pickaxe → cobblestone → stone pickaxe → furnace | All six stages passed with the experimental vanilla profile |
| 1.21.1 | Yes | Logs → table → wooden pickaxe → cobblestone → stone pickaxe → furnace | All six stages passed with the native profile |
| 26.3 | Not tested | Official local server started | No agent gameplay claim |

The successful 1.20.4 and 1.21.1 trials took approximately 100 and 97 seconds respectively. They used different worlds and are functional checks, not a controlled speed comparison. Their reports identify the build as `1.0.0-Arthas-dev.2`: the compatibility changes were tested before the dev.3 version bump. The original identity and UTC timestamps have been retained in the [curated evidence summary](results/version-lab-2026-10-15.json). Raw runtime reports remain local under `data/version-lab/`.

The isolated 1.16.5 crafting diagnostic also confirmed boards, a table and a wooden pickaxe after reconnecting, but its clean from-zero trial did not pass the stone gate. It remains experimental. The dev.3 dashboard/programming checks are [recorded separately](results/arthas-dev3-validation-2026-10-15.md).

## Reproduce locally

Use Node.js 22.13 or newer. Download exact official server JARs into a directory beside this checkout:

```powershell
node scripts/prepare-version-lab.js --accept-eula=true
```

Read and accept the [Minecraft EULA](https://www.minecraft.net/eula) before using `--accept-eula=true`. The script verifies SHA-1 hashes supplied by the [official Mojang launcher manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json). Each instance binds to `127.0.0.1`, has an isolated world and a different port, starts in peaceful Survival, and runs in offline mode for local testing. Existing server configuration is left intact. The server files and test reports are excluded from the source package.

| Version | Local port | Java runtime used |
| --- | ---: | --- |
| 1.8.8 | 25570 | 8 |
| 1.12.2 | 25571 | 8 |
| 1.16.5 | 25572 | 8 |
| 1.18.2 | 25573 | 17 |
| 1.20.4 | 25574 | 17 |
| 1.21.1 | 25575 | 21 |
| 26.3 | 25576 | 25 |

Start one server at a time from its own directory with the matching Java installation. For example:

```powershell
cd ..\overmind_version_lab\1.20.4
& 'C:\path\to\java17\bin\java.exe' -Xms128M -Xmx768M -jar server.jar nogui
```

In another terminal at the repository root, run the bounded empty-inventory trial. Use a **new nickname for each attempt** to avoid counting items retained from a prior run:

```powershell
$env:MC_PORT='25574'
$env:MC_VERSION='1.20.4'
$env:MC_EXPERIMENTAL_VANILLA='1'
node examples/curriculum-live.js --tier=stone --name=Stone1204A --minutes=8 --output=data/version-lab/1.20.4
```

For native 1.21.1, omit `MC_EXPERIMENTAL_VANILLA`. The JSON report records the starting inventory, actions, each stage, corrections and final inventory. The stone claim requires a passed `cobblestone` stage with `fromZero: true`; reaching `ready`, breaking a stone block by hand, or receiving stone from an operator is insufficient.

## Evidence boundaries

The lab servers are vanilla and local. Successful trials do not establish compatibility with modded servers, plugin menus, online authentication, Realms, anti-cheat policies or every historical patch release. Unsupported wire protocols and failed gameplay steps remain visible as such. Do not extrapolate from a protocol codec round trip to full survival support.
