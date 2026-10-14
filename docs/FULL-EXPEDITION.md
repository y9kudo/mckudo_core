# Full run: From empty equipment to dragon

Author: **y9kudo**. Start File: [`examples/from-zero-to-dragon.js`](../examples/from-zero-to-dragon.js). Logic is in the core: `fullExpeditionScenario`, `createEndExpedition`, Resource planner, Neser module and dragon policy. The startup file connects the client, Writes a magazine and controls the stop.

This is **Test profile**, Not the confirmed autonomous passage. A Won With Won Avery07 In Enda, it doesn't replace the run from scratch. Version 1.0 not automatically appointed.

## Training in VS Code

Requires Node.js 22 or 24 and local Minecraft Java 1.21.1 Survival-server with `online-mode=false`. Open the folder `mckudo_core` in VS Code and open the terminal PowerShell. Do it:

```powershell
npm.cmd ci
npm.cmd run expedition:check
```

Second team checks script and performance, **without connection** to Minecraft. `npm.cmd` operating unchanged PowerShell ExecutionPolicy.

## First launch

```powershell
$env:MC_HOST = '127.0.0.1'
$env:MC_PORT = '25565'
$env:MC_VERSION = '1.21.1'
$env:MC_NAME = 'RowanJourney01'
$env:MC_WORLD_ID = 'survival-world-01'
$env:MC_REPORT = 'data/full-expedition/report.json'
$env:MC_RESUME = '0'
$env:MC_TEST_MINUTES = '0'
npm.cmd run expedition:full
```

`MC_NAME` — New player name without previous items. `MC_WORLD_ID` — permanent name **of this particular world**; Change it when you recreate the world. `MC_TEST_MINUTES=0` means no overall period; for example `30` Limit the test to half an hour. Individual actions still have a time frame-Authentication.

Start only in the upper world, in Survival, empty equipment and no armor. Script does not use `/give`, `/tp`, `/gamemode`, `/locate`, `/fill` or the coordinates of the fortresses ready. Don't give the agent your stuff and don't teleport it, If you check your autonomy. The normal observer may be present; His presence is recorded.

`fromZero` Confirms empty start-up equipment, Not the absence of all future interventions. Large server corrections and confirmed interventions require a log view. For result 1.0 I need a controlled new world and a full-record check.

## Steps

1. Wood in the accessible class, crafting table, Wooden and stone kirks, Boiler, Stone sword; before descent — 8 logs and portable tools to replace tools.
2. Iron, shield and iron equipment; Then home. The defence takes precedence over construction and mining.
3. Diamond pick, Osididian and light-signalling; A range of arrows, blocks and other armor.
4. The frame and confirmed entrance to the Neser; Gold detail of armor, Coal, Food and transported workstations are prepared before entrance.
5. Searching for Neser's Resources: 10 rods, 24 Pearl, mature growth and sand of showers. Four pearls saved after the craft 20 Eye. Piglin exchanges possible; Casual depositions are not guaranteed.
6. Return through a remember portal; Ender's eye, Measurement of its flights, Search for a fortress and fill the framework.
7. Entrance to Andd, crystals, Breath avoidance, Shots fired and attack on the head of the sitting dragon.

Target only ends when the dragon and agent's own loss is confirmed by server. Timer, lack of substance or status «attack sent» Not considered victory. A full set of charms and self-contained potions are not yet in the confirmed profile; They cannot be considered as having been carried out on this launch.

## Where to View Results

For the brought `MC_REPORT` established:

| File | Appointment |
| --- | --- |
| `data/full-expedition/report.json` | Current phase, equipment, Health, Errors, Recent actions and outcomes. |
| `data/full-expedition/report.events.ndjson` | Full sequence of actions, attacks, server damage, and control points. One line — one event. |
| `data/full-expedition/report.memory.json` | Navigation memory training/Planning, Steps and portals for continuation. |

Report and memory is recorded as a replacement for temporary file. Folder `data/` deleted Git. Completion code `0` means a confirmed purpose; `1` — Stop, Death, Loss of communication, error or incomplete purpose.

`status=blocked` and `progress.status=stalled` Explain the current stop, But don't make the goal complete. The text of the reason and actions from the journal is needed to correct the kernel.

## Stop and continue

In the terminal, press **Ctrl+C**. Also, you can create a control file from the second terminal:

```powershell
Set-Content -LiteralPath 'data/full-expedition/report.stop' -Value 'stop'
```

New start checks this file every second and cancels the current action. For continuation delete only this file, Keep the old name, peace, address and routes, Then execute:

```powershell
Remove-Item -LiteralPath 'data/full-expedition/report.stop' -ErrorAction SilentlyContinue
$env:MC_RESUME = '1'
npm.cmd run expedition:full
```

We need both old files: Report and memory. Another scenario, server, Player or world is rejected. Arbitrary modification of the phases requires a new run. The dragon's previous memory death is not a substitute for a new server confirmation.

By default death stops the test. For debugging, you can turn on:

```powershell
$env:MC_AUTO_RESPAWN = '1'
$env:MC_MAX_DEATHS = '3'
```

After re-reacting, the controller re-checks the supply from the beginning, Instead of continuing a trip to Neser without lost tools. Deaths are still in the report; Such a run should be evaluated separately from the passing without death.

## Output condition 1.0

We need a full full-scale game run without resources and teleports, confirmed victory with its own loss, View errors and server corrections, Re-automatic checks and published description of the actually tested possibilities. Even a successful report doesn't publish a release on its own. Until these conditions are fulfilled, the version remains 0.7.0 with local changes in training 1.0.
