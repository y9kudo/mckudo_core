# Checks v0.6.0

Relis 0.6.0 prepared by 11 October 2026. A successful separate phase is not considered complete Minecraft.

## Final release check, 11 October

`npm.cmd run check`: **319/319**, No passes. Added closure checks for disc error/brain, Flatted closure and release of the panel port. Strict TypeScript-verification `test/types/daily.mts` I'm past. `npm.cmd run release:check` and `npm.cmd run test:package` pass: Both archives are listed in a separate annex, Main imports, Lazy registries, Mission, memory and file CPU worker working; Mineflayer No in the established annex.

**RowanRelease06**, offline Java 1.21.1, Port user server 25565: empty equipment → Tree by class → crafting table → wooden pick → Stone pick → Boiler. Status `passed`, **157 seconds**, Health **20/20**, **0 of the position correction**, 44 Action, 2 Recovery error. Planner: 44 episode, 506 updates; Maintain and restore the planner/Spatial memory confirmed. Hunting, Sleep and collection from storage is off-line to isolate test; No administrative issuance of items. The existing world has been used, not isolated new seed.

In the last window 128 Local frequency **12,02 Hz**, Average interval 83,20 ms, p95 327,42 ms. This identifies the remaining observation load/Planning; the result is not given for stable 20 Hz or network improvement ping. The game profile requires further optimization under full load. Agent disabled after verification.

Slowly managed total: [verification-06.json](results/verification-06.json). The raw report `data/agent-live-2026-10-11T17-51-32-994Z.json` remains local. The historical results below relate to previous audits of this issue.

## Automatic checks

11 October 2026 Total `npm.cmd run check` I'm past: **316 tests, 316 successful, No passes**. Strict verification TypeScript API I'm past. Checked simple API agent, Disconnect/Scenarios, Spatial memory conservation, calculation line, The relevance of the readings, Risk screening, exit through steps and the account of the dug-up/units in transit. Added checks CPU worker, Overcrowding, flow-replacement, Obsolescence geometry, DDA visibility, exclusion of hidden lobes, Hunt restrictions, the return of the impasse, horizontal branches of the mine, portal memory and additional resources smelting. Three physical schedule checks confirm no accumulation of late, A series of follow-up steps after pause and call after stop.

## Simple missions, coordinates and bridges: 11 October

The 10 new tests cover the compilation of simple JSON, errors before connection, Materials classes, bridge resource development, Temporary exclusion of a failed point, Expired position, A confirmation of achievement, direct retention/diagonal edge, High-rise construction with inventory consumption, Detachment and leg-end crucifix. High bridge tested in a modeled world through state physics; No separate server run for high-rise construction yet.

**HarperNav11**, vanilla Java 1.21.1, `127.0.0.1:25565`: new `agent.goTo` reached cell **X 12, Y 71, Z −8**, Final Position **12,509 / 71 / −7,5**, Health **20/20**, adjustments **0**, error **0**. Verification performed without construction, and administrative teams. Report `data/mission-live-2026-10-11T13-45-57-262Z.json`, Area of verification `coordinate-goal`. Agent offline.

Individual running **MasonMission11** empty equipment, wood target, The stone pickaxe and the furnace are finished **incomplete**: The agent died during the night while protecting himself from the mobs before the resources were obtained. Movement Adjustments **0**, local timer near **19,99 Hz**. Report `data/mission-live-2026-10-11T13-42-25-012Z.json`. This result is not considered to be a successful game or a success; Sustainability without equipment requires further work.

Retry: `npm.cmd run test:live:mission`. Separate coordinate check: `node examples/mission-live.js --navigation-only`. Details and simple API: [Missions and bridges](MISSIONS-AND-BRIDGES.md).

## Protection of buildings and military bypass: 11 October

15 New automatic checks cover measurement areas, Construction characteristics, choice of birch instead of the beam of the house, No production in the event of a change in the ban, Maintaining their own blocks without bypassing areas, Prohibition of bridges, ♪ ♪ ♪ ♪ Over the walls in battle ♪, Get up to the stage, Rescission of prospecting, Restriction of pursuit and shifting between threats. Shield and conventional weapons reconstruction tests were also completed.

A repeat general run revealed a unstable descent near the player. The separate play showed side-mapping at the wall during braking: checked the area beyond the current target. After correction passed 15 The number of consecutive descent re-entrys and the determinated calculation check itself added. Total complete run — 306/306.

Local offline-server Java 1.21.1 **HarperGuard11** implemented `npm.cmd run test:live:protection`. `dig`, `place` and `pillar` Refuse to act within the temporary protected area `KUDO_PROTECTED`; Then the agent walked four steps inside her. Sent **0 Cluster change packages**, of the position correction **0**, Health **20/20**. Outcome `passed`, Local report `data/protection-live.json`. The character is off after checking. It's a client protection and walking test, Not proof of a battle victory or full passage. The combat bypass and the jump in this change are checked by simulated geometry and physics.

[Area and behavioural settings](BUILDINGS-AND-PVP.md).

## Expedition and reaction: 11 October

**EthanCore11**, Java 1.21.1, `127.0.0.1:25565`, Survival, empty initial inventory and no armor. The test was long 8 minutes, result `incomplete`, `goalAchieved:false`. Agent got the oak logs, He created the Versac, Wooden and stone crickets, Boiler; phase `stone-tools` confirmed. When I looked for iron, I went down from the surface to the Y 36. At the end, health remained 20/20, 43 Rocket, 22 Diorite, Bake and both crickets. Another player was observed: It's not a test in an empty isolated world.

The racing revealed a constant pre-emptive protection against the mobs outside the mine wall. A visibility test has been added after this; The separate continuation by the same character is noted `resumed:true`, `fromZero:false`. It doesn't replace the primary report and it's not considered another start from zero. Return to the upper stage from the impasse added separately and tested by automatic test.

The consistent continuation is the same EthanCore11, with his stored equipment:

| Verification | Duration | Actions | Result |
|---|---:|---:|---|
| Visibility | 301 with | 0 | False fighting stopped; There was a mine dead end |
| Return by stage | 181 with | 30 | Up with the Y 36 Total Y 37 And cleared another passage |
| Advanced Search for an Exit | 121 with | 68 | Continues mining and checking exits; One route has exhausted the budget A* |

All three of them: Health 20/20, zero position correction, No defensive combat. Phase `iron-equipment` Uncompleted; Last 99 and 22 diorite is not issued for iron. Horizontal branch with non-enclosed descent added after these runs and separately confirmed by automatic test; This last branch is not yet checked on the server.

Full passage before Nether, End And victory over the dragon in this trial **Not confirmed**. The reports of the attempts are stored locally in `data/dragon-reaction-oct11.json`, `data/dragon-reaction-resume-oct11.json`, `data/dragon-reaction-backtrack-oct11.json`, `data/dragon-reaction-exits-oct11.json`; runtime-Data not included in published package.

Synthetic CPU-The test checks the same 13 Candidates: time A* 313,5 ms synchronous / 332,0 ms worker, Maximum burst of the control timer 313,8 / 16,0 ms. This is a confirmation of the reduction of main stream lock, Not acceleration itself A*. [Methodology and limitations](RUNTIME-PERFORMANCE.md).

## Timetable for physics: separate game run

After cruise runs, the accumulation of local timer delays was corrected. **MilesClock11**, The new character on the same offline-server, `npm.cmd run test:live:timing`: normal movement to observed point X 10, Y 71, Z 8 It's gone. Average interval of the last 128 Steps — **50,09 ms / 19,97 Hz**, maximum 63,35 ms; 0 per cent longer 75 ms, 0 0 correction, Health 20/20. Status `passed`, Report `data/timing-live.json`.

It's a client with a short route check, without full expedition reactor set. In previous expeditions, the local frequency was 14,8–16,6 Hz; Different loads do not allow the whole burst to be attributed to one change. Determinated tests separately confirm the elimination of the accumulation of timer delays. All test clients are off-line; After the test, only the player was notified by the server y9kudo.

HTTP-The panel test is now also passing. Limitation loopback, observed 8 October, No copy in the current environment. Test files are run with `--test-concurrency=4`, so that dozens of separate processes Node did not overload the PC at the same time as Minecraft; Time-The vehicle is not required to be checked by the vehicle.

Load test without Minecraft (`npm.cmd run test:runtime`), 11 October: The same 30 000 knots, Maximum time interval of the reference timer 976 ms in synchronous search and 31 ms in total. Total time — 976 and 1 032 ms, respectively. Measured with background load of automatic tests; It's a test of responsiveness, Not the maximum PC productivity estimate. [Methodology, API and limitations](RUNTIME-PERFORMANCE.md).

The test compares two available sources: After a sequence of failures, one and another have different risks, and resource objective changes choice. Retreaded weights give the same estimate. This is a test of local learning arrangements, Not a statistical assessment of the universal game force.

## Real server 1.21.1: simple API, 11 October

`examples/agent-live.js`, offline-User server `127.0.0.1:25565`, English names, without administrative issuance of items. The same world is used for repeat launches: existing facilities and stations retained.

First agent **AtlasCore11** Started with empty equipment, I got wood, I made a wood and a wood kirk, But stopped after six failed approaches to the verstuke from the work. Status `incomplete`, 215,6 seconds. This report is saved. After the approach was corrected, the same ordinary mining agent cleared the exit, I'm up with Y 63 Total Y 66 And shaved a stone brick.

Repeat with new agent **BlakeCore11**:

| Verification | Result |
|---|---|
| Primary equipment | Empty |
| Scenario | Wood by class → crafting table → wooden pick → Stone pick → Boiler |
| Outcome / time | `passed`, 194,9 seconds |
| Actions | 23 navigation, 15 Mining, 18 Rebounds, 8 Krafts have been successful |
| Errors and recovery | 3 mining errors, 1 Lack of ingredients after station preparation; Target then achieved |
| Health / Heading correction | 20/20; 1 server correction |
| Reciprocies | 1 290 announced by server, 62 result indexed on request |
| Planner | 68 episodes, 818 balance updates |
| Navigation | 277 transitions, 4 589 balance updates |
| Spatial memory | 2 048 Records, 15 Observations withdrawn |
| Save and load | Both checks: Planner and spatial memory — successful |

The final inventory contains both kirks, Boiler, 3 boards, 3 land and 3 eggs. Eggs were picked up in the world before the tree was harvested; No test was given on finished equipment. In the last window 128 Tics average local timer interval — 59,3 ms, p95 — 64,1 ms. These indicators are not online ping or TPS servers.

Raw reports: `data/agent-live-2026-10-11T10-49-16-738Z.json` (launch) and `data/agent-live-2026-10-11T10-57-00-391Z.json` (repeat). They're local; The error log is not removed for success. [Launch and API](SIMPLE-AGENT.md).

After the final correction of the track changes, another full run was completed — **CharlieCore11**, empty equipment, same server and world. All five goals are met for **88,1 seconds**: 5 navigation, 14 Mining, 13 and 8 Crafts are successful; One selection was not confirmed and was processed as a mistake. Health 20/20, of the position correction 0. Final inventory: Wooden and stone kirks, Boiler and 3 boards. The planner saved up 41 episode/467 updates, navigation — 67 transitions/1 019 updates; maintenance and restoration of the planner and 1 744 Spatial memory records confirmed.

Final run report: `data/agent-live-2026-10-11T11-05-56-142Z.json`. The time difference between agents does not prove acceleration by a certain number of times: Agents use different routes, And the past tests changed the world. Total Test Series: One incomplete launch with identified error, separate check of its correction and two successful five-stage launches.

## Real server 1.21.1: One agent, 8 October

`examples/recipes-live.js`, Agent BlakeGrowth, New user world, Start equipment empty.

| Verification | Result |
|---|---|
| Goal | Wood by class → crafting table → wooden pick |
| Time | 153,6 seconds |
| Reciprocies | 1 290 announced by server; 57 Results indexed on request |
| craft | 6 Successful operations, Station installed |
| Mining and selection | 3 Successful mining, 3 successful selection |
| Errors | 4 Unaffordable mining sites; The agent then took another approach |
| Planner | 30 episodes, 324 Balance updating; Model recovery verified |
| Navigation | 175 transitions, 2 855 balance updates |

Final inventory: wooden pick, 3 oak board, 2 Sticks. The established is in the world. Administrative issuances fail to perform the test. The raw report is kept locally in `data/recipes-live-report.json`.

## Early game tests

- 2 October, AtlasLearning: Three short routes, 15 transitions, 135 balance updates; Peace Book and Neuronet Recovery confirmed.
- PillarScout01: A simple jump with three blocks under your feet and a pole-by-post review; Health 20, server correction 0.

## Command test

First launch 10 agents stopped at the entrance: LAN-The server had 8 Slots, Seven bots and the world's master filled it up. Resource phase not started; Successful cooperation is not a result.

Run 20 Agents on a separate vanilla-server 1.21.1 completed before the change in responsiveness with status `incomplete`: 11 from 20 agents had a wooden pick, recorded 663 coordination and 406 resource requests. This is not a successful completion of the entire command objective. The report is located locally in `data/fleet-learning-live.json`; I still need a re-play.

## What has not yet been proven

A complete victory over the dragon from empty equipment, level PvP Against a Strong Man, Living non-serite improvement and performance of game adapters 26.3/old versions not confirmed by these checks. The potion barca is now presented by the planner without a real performer.
