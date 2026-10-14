# Full expedition: fresh Survival spawn to the Ender Dragon

OvermindMC is a reusable kernel. `examples/from-zero-to-dragon.js` connects OMConnect and runs the library's `fullExpeditionScenario`; it does not contain a separate scripted Minecraft brain. Author: **y9kudo**.

The profile is an integration test, not proof that autonomous completion has already succeeded. The current package remains `1.0.0-Arthas-dev.1`. A timer, completed simulation or equipment-assisted End fight cannot certify the stable Arthas release.

## Prepare and start

Use Node.js 22.13 or later, preferably Node.js 24, and a Minecraft Java 1.21.1 Survival server with `online-mode=false`. In the project folder, open a PowerShell terminal:

```powershell
npm.cmd ci
npm.cmd run expedition:check
$env:MC_HOST = '127.0.0.1'
$env:MC_PORT = '25565'
$env:MC_VERSION = '1.21.1'
$env:MC_NAME = 'ArthasJourney01'
$env:MC_WORLD_ID = 'survival-world-01'
$env:MC_REPORT = 'data/full-expedition/report.json'
$env:MC_RESUME = '0'
$env:MC_TEST_MINUTES = '0'
npm.cmd run expedition:full
```

Choose a new player name: an existing offline player can retain inventory and equipment. `MC_WORLD_ID` identifies this particular world and must change when the world is replaced. Configuration checks do not connect to Minecraft. `MC_TEST_MINUTES=0` removes the overall deadline; individual actions remain bounded and cancellable.

The start requires an empty inventory, no armor, Survival mode and the Overworld. Do not grant items or teleport the agent. The launcher does not use `/give`, `/tp`, `/locate`, `/fill` or `/gamemode`.

## Campaign stages

1. Obtain nearby logs by class, a crafting table, stone pickaxe, furnace and stone sword; retain spare wood.
2. Mine and smelt iron, craft a shield, then prepare iron equipment.
3. Build a small shelter, obtain a diamond pickaxe, obsidian and flint and steel.
4. Prepare armor, bow, arrows and blocks; acquire food, gold, fuel and portable workstations.
5. Build and activate a Nether portal, then enter through the observed portal.
6. Explore the Nether for blaze rods, ender pearls, mature Nether wart and soul sand. Observed piglins can be bartered with; pearls are counted only after actual collection.
7. Return through a remembered, rechecked portal, craft Eyes of Ender, measure their flight directions and search the stronghold.
8. Activate an existing End portal and enter the End.
9. Destroy crystals, evade dragon breath and fight the dragon, including melee opportunities during its perch.

Completion requires server evidence of the dragon's death and this agent's own correlated damage. An entity disappearing or an attack packet being sent is insufficient. Enchanting and autonomous potion execution are not mandatory confirmed steps in this profile; planning recipes alone does not demonstrate their execution.

## Watch progress and learning

In a second terminal:

```powershell
npm.cmd run expedition:status -- data/full-expedition/report.json --watch
```

For machine-readable output, add `--json`. The status includes the current stage, completed stages, health, inventory, deaths, action failures and learning updates.

| File | Contents |
| --- | --- |
| `report.json` | Current segment, campaign start, stage, inventory, timings, heartbeat and release checks. |
| `report.events.ndjson` | Append-only actions, attacks, damage, corrections, checkpoints and learning snapshots. |
| `report.memory.json` | Learned planning/navigation weights, replay, scenario checkpoint and confirmed placement ownership. |
| `report.segments.ndjson` | Finished segment reports, preserved across restarts for later review. |

Files follow the path in `MC_REPORT`; `data/` is excluded from Git. Reports and memory use temporary-file replacement. A heartbeat updates the report during long actions.

The live profile trains local failure-risk and navigation-cost networks with online backpropagation and bounded replay. Reports record samples, updates, weight hashes and recent experience. Changed weights demonstrate actual parameter updates; they do not demonstrate mastery of the entire game. PPO/SAC physical-policy experiments are separate from this symbolic campaign controller.

## Stop, resume and recover

Press Ctrl+C or create the control file from another terminal:

```powershell
Set-Content -LiteralPath 'data/full-expedition/report.stop' -Value 'stop'
```

To continue, keep the same player, world identifier, server and report path. Retain both the report and memory:

```powershell
Remove-Item -LiteralPath 'data/full-expedition/report.stop' -ErrorAction SilentlyContinue
$env:MC_RESUME = '1'
npm.cmd run expedition:full
```

Resuming restores learning and scenario progress. Ownership of the agent's confirmed workstations is also retained, so its own furnace does not become a foreign protected structure after restarting. Foreign structures and explicit protected regions remain protected.

By default a death ends the run. To test autonomous recovery:

```powershell
$env:MC_AUTO_RESPAWN = '1'
$env:MC_MAX_DEATHS = '20'
```

The death limit applies across resumed segments. After respawning, the controller rechecks the campaign from its initial supply stages instead of entering the Nether without lost equipment. Deaths remain in the evidence and must be disclosed.

## Stable release gate

`releaseReadiness` checks the empty Survival start, every campaign stage, own dragon victory, recorded interventions, unexplained teleports and durable evidence. Until all gameplay checks pass it reports `in-progress` or `blocked`. After passing it reports `needs-review`; the launcher never publishes or marks a stable release automatically.

Review the complete journal, item provenance, other players' actions and server corrections, then run automated checks before releasing Arthas 1.0.0. An empty initial inventory alone cannot prove that no player supplied items later.
