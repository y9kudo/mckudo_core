# Cooperative race six versions

Author **y9kudo**. In one real world Java 1.21.1 The agents are working simultaneously on the OvermindMC 0.2.0, 0.3.0, 0.4.0, 0.5.0, 0.6.0 and 0.7.0-dev.0. Goal — First to obtain the diamond by itself; Participants can assist in materials. It's a team game experiment: Its results cannot be considered as an isolated comparison of the speed of the versions.

## Training

Need full Git-History clone `mckudo_core`, Node.js 22+ and dependency, including old client adapters: `npm.cmd ci --ignore-scripts`. For 0.3.0 You need a real stored archive `mckudo_core-v0.3.0.zip`: in accessible history Git No separate commite of this version. By default, it is searched near the project catalogue; The other way is set through `$env:MC_V03_ARCHIVE = 'C:\archives\mckudo_core-v0.3.0.zip'`. In the absence of the archive, the training is suspended; other code under number 0.3.0 not subject.

```powershell
npm.cmd run benchmark:diamonds:prepare
npm.cmd run benchmark:diamonds:check
```

The training produces separate images of the originals in the excluded Git folder `data/diamond-sources-*`. Saved for each version Git SHA either SHA256 Original archive, version from `package.json` and hash contents. The startup shall also verify the version of the kernel being performed. The current work code and old pictures don't replace each other. B Windows Common defined relationships available via images directory junction; Current version and hash lock-Files are recorded in the report. This is a comparison of historical code in the general transport environment, Not replicating all old addictions.

## Starting

At offline-The server should have six available seats, mode survival and protocol 767 (Java 1.21.1). The server isn't changed by the administrative teams. Names received by random suffix, To avoid loading the inventory of previous participants.

```powershell
$env:MC_HOST = '127.0.0.1'
$env:MC_PORT = '25565'
$env:MC_TEST_MINUTES = '15'
npm.cmd run benchmark:diamonds
```

All six clients first connect, Check empty inventory and survival, Then they get the total start point. At least one race doesn't start when you're not ready. `startSkewMs` shows the real error of starting each process. Clients live in separate homes Node.js-processes; flow CPU and memory is recorded for each process. CPU includes the service function of the meter; online ping and TPS servers are not measured by this indicator.

Panel: `http://127.0.0.1:4181/`. Use it for another port `MC_RACE_UI_PORT`. She only listens localhost and allows you to read state; control command command via HTTP no.

```powershell
npm.cmd run benchmark:diamonds:status
```

To correct stop press Ctrl+C in the launch terminal or create an empty `stop.request` in the current report catalogue, as shown at start-up. Time limitation — 0.5–120 minutes. The participant's first life ends at death; No automatic revival. Winning, Only test bots processes are closed or stopped. Minecraft-server continues to operate.

## Continuation after limit

To continue the unfinished race, run **The same world that was saved**, Then give her the report:

```powershell
$env:MC_RACE_RESUME = 'data/diamond-2026-10-11T20-24-42-065Z/report.json'
$env:MC_TEST_MINUTES = '15'
npm.cmd run benchmark:diamonds
```

The new phase uses the old names, Positions and investments, Saved Minecraft-server. The old report is not re-recorded. `continuation.previousRunId` Connects steps; `activeElapsedMs` and the time of the objects only add up the time of the test, excluding pause. The current phase &apos; s overall start remains `startedAt`. `fromEmptyInventory` describes the beginning of the entire series, `segmentFromEmptyInventory` — current phase. Policies and memory re-start: It's a sequel with stored game resources, Not a continuous process. Dead actors, processes not closed, Other server, modified reference points or relationships are rejected.

The sources of historical libraries remain unchanged. The overall bandage may be corrected between stages: Every new report is recording `runnerSHA256`, The impact of logistics changes should therefore be indicated separately. In particular, The assistant now saves the only crafting table, Doesn't give it a version without a craft and can pass the younger kirk after getting the best. It's a correction to the application of the benchmarking, Not the upgrade of the historical core.

For **new** An empty race with empty equipment remove the extension parameter:

```powershell
Remove-Item Env:MC_RACE_RESUME -ErrorAction SilentlyContinue
```

## Miscellaneous versions — Different opportunities available

| Version | Profile in the application of the benchmarking | Limitation |
|---|---|---|
| 0.2.0 · Atlas02 | Normal rules: wood reserve; Mining of diamond ore, if obtained/Diamond/Non-heritite curly | No craft and no self-sustaining survival |
| 0.3.0 · Brooks03 | Published Versta profile/sticks and their operators; diamond additional target, requiring a suitable instrument | No crafting table in the adapter; An elusive goal can block the planner |
| 0.4.0 · Carter04 | Own `planResources` by observed sources, stations and installation; implementation through its own Core | Annex scenario prepared, The search for sources is limited by the old radius 24 |
| 0.5.0 · Dylan05 | Own `createMinecraftBrain` and OMConnect, Objective `diamond: 1` | Conduct of historical code without correction 0.6/0.7 |
| 0.6.0 · Elliot06 | The brain and client, same objective | Cold start of memory; No new corrections to perception carried over |
| 0.7-dev · Flynn07 | Your own brain, customer and same purpose | Does not guarantee the achievement of the goal; failures are being recorded |

The objectives and rules are in the general driver `examples/benchmark/diamond-worker.js`, The library sources are taken from only the images. For modern profiles, the extraction from the chests has been disabled, Sleep, Non-binding hunting and attacks on players. Normal protection and accessible food arrangements remain part of the version. New races use new names; The need for a clear continuation `MC_RACE_RESUME`.

## How Aid Works

Common logistics assistant outside the historical brain reads images of the equipment through IPC. He's offering to pass the surplus of the tree, board, Tails, crafting tables, Rocket, iron and tools for a nearby participant. The donor is physically fit, Looks at the recipient and throws out the items. Old clients use Mineflayer `toss`, new — Your skills `drop`. Gambling chatter, No transport and change of equipment.

Diamonds and diamond/Non-serite items not transferred. Material reserves maintained; assistance may not be provided-for the movement of the recipient, no route or change of inventory. `requested`, `failed` and `dropped` — Different entries. **`dropped` Confirms the release of the donor, but not received by a specific addressee**: The other participant may choose the subject. Such noise is part of the world and is not declared a successful target.

## Victory and reports criterion

One diamond in inventory is not enough. We need a successful mine `diamond_ore`/`deepslate_diamond_ore`, Observed diamond picking near the mine block and positive inventory counter. Observations should be relevant to the current start and be placed in a limited correlation window. Random diamonds from players or from other people's deaths without their own mining are not considered to be a victory. This is a confirmation from client observations; No server log of origin.

`data/diamond-<timestamp>/` contains:

- `report.json`: Sources of versions, Start, State, Errors, Production and transfer;
- `results.csv`: The time when resources first arrived/instruments and confirmed diamond;
- `report.html`: saved final table;
- Individual client technical logs.

The time the tool appeared in the inventory could mean as a craft of its own, So the selection of the gift. Watch it separately `actions` and the transmission log; One column CSV You can't attribute an object to an independent craft. Do not hand over items to participants during the run and do not use the issuing command: otherwise it should be marked as interference in the common world.

If no one has obtained the diamond, result — `incomplete`, Not a fake winner. Initial positions, living world, Total resources, Different profiles and help do not allow one such run to declare a universal version faster. A strict comparison will require repetition on copies of a fixed start world.

Saved Results: [phase 1](results/diamond-race-2026-10-12-stage1.md), [phase 2](results/diamond-race-2026-10-12-stage2.md). [Workmen &apos; s corrections 0.7 and separate diagnostics](RACE-FIXES-07.md) not substitute historical results.
