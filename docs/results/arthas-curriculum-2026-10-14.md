# Version Arthas: curriculum and Survival · 14 October 2026

Compilation `1.0.0-Arthas-dev.1`, user name `v1.0.0Arthas-dev.1`, The author y9kudo. Node.js v24.19.0, Windows.

## The real one Minecraft

Local offline-server Java 1.21.1, `127.0.0.1:25565`, Survival. Starting:

```powershell
node examples/curriculum-live.js --tier=stone --name=ArthasTrial03 --minutes=8 --output=data/arthas-live-03
```

Primary equipment and armor. The test did not send out the delivery teams, Mode change or teleportation. Use of negative resource planning OvermindMC/OMConnect, not moved DQN from headless-Environment.

| Phase | Outcome | Time |
| --- | --- | --- |
| 4 logs by class logs | Passed | 37.178 with |
| crafting table | Passed | 0.529 with |
| Wooden pickaxe | Passed | 2.129 with |
| Boulder | Passed | 113.144 with |
| Stone pickaxe | Passed | 2.997 with |
| Boiler | Passed | 24.005 with |

Total time with connection and completion — **181.064 with**. Health at the end — **20**. Silver correction — **0**. Acquired furnace, Stone and wooden pickles in final inventory. crafting table was created and used in intermediate stages; It was not required in the final inventory.

Yes 63 Action, among them are three selection failures. The selection errors did not become an endless priority over the main goal. A significant transition was required before the stone was extracted; The result is not declared perfect speed.

Local full report: `data/arthas-live-03/report.json`.

## Found and corrected errors

1. First agent stuck in the woods: a close inaccessible source of the same breed continued to participate in class selection, And a series of rebound attempts took time. The filtering of inaccessible sources in class selection and the temporary assignment of the main task after two selection failures have been corrected. The Lut's Change/Agent and new conditions allow for revision.
2. The second run confirmed the wood, Then discovered the error of the new definitions: Unnormalized ID I think so `crafting_table`. Corrected namespacing all game goals; Now every script is checked before connection.
3. Initial headless-The test took on random successes at high levels epsilon for the basis of transition. Added greedy validation gate and test, I think the end of the old batch Not certified by several new stages.

First and second game reports are saved in `data/arthas-live/` and `data/arthas-live-02/`. Failures not granted for passing.

## Headless RL

```powershell
node examples/train-curriculum.js --envs=128 --workers=2 --batches=4000 --output=data/arthas-curriculum-validated
```

128 Wednesday, two workers, **512000 transitions**. Network 22 → 48 → 12, replay 20000, batch 64. You need to go through the crossing ≥85% window success and ≥85% Total 32 validation seed without epsilon.

| Confirmed validation-Phase | Successful episodes |
| --- | --- |
| wood-near | 30/32 |
| wood-search | 31/32 |
| wood-sparse | 31/32 |
| wood-distance | 30/32 |
| table | 29/32 |
| wood-pickaxe | 29/32 |
| cobblestone | 29/32 |
| stone-pickaxe | 29/32 |

In progress **furnace** crossing stopped; Final estimate for selected seed Yes **0/32**, Episode restriction 360 Steps. This is a gap that has been detected RL, Despite successful game crafts of the furnace. Availability of definitions 20 Stages don't mean, I think the network has learned everything 20.

RSS after this run — Near **428.1 MiB**; This is a picture, not peak. Longer education and validation They're using more memory, the short old benchmark. You can reduce `envs` and `workers`.

Data and checkpoint in `data/arthas-curriculum-validated/`; They are excluded from Git. Resumption check was conducted separately with copy checkpoint, 32 Wednesdays and one worker: More 100 batches / 3200 transitions. The furnace has grown to 17/32, below the threshold 85%; No transition permitted. Environment and replay No re-opening carried over.

## Results limits

In the present world, only the profile to the furnace was tested. Iron and diamond kits, Pass to dragon and full transport DQN The game adapter has not been confirmed by this test. Stable release 1.0.0 not issued.

## Code Checks

`npm.cmd run check`: **500/500** tests; strict TypeScript-contracts completed. All game scenario definitions checked, 10 tasks headless with control decision-maker, memory curriculum, discharge worker-Wednesday, validation gate and limit the progress of one old batch. The control camera checks the mechanical capability, but its results are not considered to be learning DQN.
