# Corrections 0.7 on the results of the race

Author: **y9kudo**. Changes refer to the operating branch after `v0.7.0-dev.0`; The published archives and historical contestants remain unchanged. [Results of phase I](results/diamond-race-2026-10-12-stage1.md) The time, Action meter and source origin.

After two steps, separate assembly **confirmed diamond mining for 93,353 seconds**, Continue with stored resources. [Diagnostic report](results/race-fix-probe-2026-10-12.md) Separated from [The History Race](results/diamond-race-2026-10-12-stage2.md). Automatic checks: 368 tests, Everyone's gone; The package configuration and completeness test was also passed.

## What Changed in the Library

| Observation | Reproduced mechanism | Corrigendum | Verification |
|---|---|---|---|
| 47 failed rebounds 0.7-dev for the first phase | The first approach to the subject was repeated even after the error, The rest of the positions weren't broken | `OMConnect.executeCollect` selects other achievable positions and remembers the object's rejected cells before changing cells, or audits of the world | `packages/omconnect/test/collection.test.js`: First approach blocked, Second confirms the inventory |
| The same things that are inaccessible distract from survival | The rebound delay remained the same after each failure | `createLootReactor`: 5, 10, 20, 40, 80, 120 default seconds; maximum 256 Records. Agent movement on 3 block, object 1 The recording shall be dropped by the unit or change of measurement | `test/survival-brain.test.js`: repeated failure increases waiting; moving object is available immediately |
| 144 failed transitions 0.7-dev | The remaining timer returned the same unreachable step in line without changing the location | `createSurvivalReactor`: memory of a failed transition before the agent's cell changes, Peace audits or blocks near launch/objectives; maximum 256 Records | `test/survival-brain.test.js`: Time doesn't unlock the route itself, The change in block will unlock |
| In the second phase, the iron pick disappeared to the diamond layer, Then the agent created a new one | The choice of tool was only based on speed; The iron pick was also used for the ordinary stone | The brain is transmitting `preservePickaxeTier: 2`: A suitable junior pick is selected, If there is one. For diamond ore, iron is retained in the selection; the only suitable instrument is not prohibited | `storage-equipment.test.js` Checks the stone, Diamond ore and the only brick; `survival-brain.test.js` Checks policy transfer |

The meter shows the scale of the problem, Not prove the cause of each individual error. Mechanisms reproduced locally: New regression tests did not first run on the old code. Time limit, map boundaries, Building security and server confirmation not cancelled. Rescission of selection for protection/Stopping and late updating of the equipment shall be checked separately.

`loot.retryMs` it's a problem **Primary** Delay, Not a fixed interval. For example:

```js
createMinecraftBrain({
  client,
  worldId: 'my-world',
  loot: { retryMs: 5000, radius: 24 },
  survival: { targets: { diamond: 1 }, preservePickaxeTier: 2 }
});
```

`preservePickaxeTier` is in the brain default: 1 — Stone, 2 — iron, 3 — Diamond, 4 — non-heritite. `false` Disables saving. Direct `chooseMiningTool` OMConnect without this option-still picks the fastest tool available. It's a policy to spend on strength, Not the guarantee, I'm sure the tool will never break.

## What changed only in the race app

The Logistic Assistant keeps the last of the characters and the best instrument of the donor, Doesn't give you a copy of the book 0.2 Without a craft and can give the younger kirch after improvement. It's a code `examples/benchmark/race-metrics.js`, which is not a historical brain. Changes of the assistant between phases are included as a condition of the experiment; They're not declared to be an improvement in the speed of old kernels.

Continuation through `MC_RACE_RESUME` as described in [of the race](DIAMOND-RACE.md). Dead members not reborn. After their death, the automatic continuation of the whole is rejected: For a new test, new names and separate report are needed.

## Checking the server assembly

The historical race checks published images. There is a separate diagnostic for new corrections, which **Not in her rating**:

```powershell
$env:MC_HOST = '127.0.0.1'
$env:MC_PORT = '25565'
$env:MC_NAME = 'RowanFix07'
$env:MC_TEST_MINUTES = '3'
npm.cmd run test:live:race-fixes
```

Requires offline-server Java 1.21.1, free slot and survival. The new name is checked for empty equipment. Profile uses brain from working copy, Objective `diamond: 1`, No chests, Sleep, ♪ I don't need to hunt and attack the players ♪. It can extract and install blocks by normal action; Extradition teams, Transport and mode change not used. At death, the attempt ends.

For diagnosis of a live participant **After all the processes of the race are closed** can state his name and final report via `MC_PROBE_PREVIOUS_REPORT`. Report to confirm live participant, Closing of the process and the same server. In this launch `fromEmptyInventory: false` Clearly indicates a continuation with resources. Don't start two clients under the same name at the same time.

B `data/race-fix-probe-<timestamp>.json` Save the shesheches of corrected files, Source and end-user, developments, Position, errors and proof of the diamond if any. `historicalRanking: false` Segregate diagnostics from the race. Status `time-limit` means only the end of observation; Successful entry does not prove successful extraction or passing Minecraft.
