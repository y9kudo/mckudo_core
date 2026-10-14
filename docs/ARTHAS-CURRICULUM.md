# Version Arthas · curriculum and game trials

Display name: **v1.0.0Arthas-dev.2**, or **Version Arthas**. OvermindMC/OMConnect package version: `1.0.0-Arthas-dev.2`. Author: y9kudo, MIT. This is a development prerelease; stable 1.0.0 requires verified autonomous Dragon completion.

## Two different applications curriculum

`headlessCurriculumStages()` contains **20 Educational levels** for DQN. `minecraftCurriculumStages()` contains up to **20 of the game resource stages**, which fulfils the existing native core. The actual launch of these targets is not a transfer headless-in the field Minecraft.

| № | Educational stage | Which makes it harder |
| --- | --- | --- |
| 1 | Nearest Tree | Small card, resources |
| 2 | Search for wood | Map 12×12 |
| 3 | Rare trees | Less wood dots |
| 4 | Further study | Map 24×24 |
| 5 | crafting table | First macrocraft resource |
| 6 | Wooden pickaxe | Several Dependent Steps |
| 7 | First Rock | Need a tool |
| 8 | Stone pickaxe | Production and improvement of the instrument |
| 9 | Boiler | Separate operation of the station |
| 10 | Raw iron | Next level tool |
| 11 | Iron smelting | Boiler, ore and wood fuel |
| 12 | Iron pick | Smelting and craft |
| 13 | First diamond | The whole tool chain |
| 14 | Diamond on the big map | Longer objectives |
| 15 | Rare resources | Limited material supply |
| 16 | Tree Among Risks | Dangerous Cells |
| 17 | A Stone Among Hazards | Risks and Craft |
| 18 | Iron among hazards | Longer plan |
| 19 | Risk Diamond | A full chain of death risk |
| 20 | A Large World With Rare Resources | Scaling skills 28×28 |

It's a "I"-the previous abstraction of skills 2D-grid, Not a full physical copy Minecraft. Dangerous nearby cells now enter surveillance. Boiler condition, The required stage and the new operation of the craft have a clear view.

## Start training

In the terminal VS Code from folder `mckudo_core`:

```powershell
npm.cmd run train:curriculum
```

By default: 128 Wednesday, up to two workers, 4000 batches, 50 completed episodes in the window. For a weaker PC:

```powershell
npm.cmd run train:curriculum -- --envs=32 --workers=1 --batches=1000
```

One common one step DQN compatible pattern of indicators. When the pool passes, it gets a new configuration and starts fresh episodes; The last award of the old episode doesn't involve a new sofa. Results of the remaining old batch Not considered as achievements of the next stage.

You need to move on **both conditions**: not less than 85% success in a full window and no less 85% Total 32 validation-Non-incident episodes. Validation implemented once per 100 batches. Automatic demotion disabled in the official launch; the individual cycle may include `demoteBelow`.

`createCurriculum()` only the statistical window. If you use API Directly, - Pass it over `record(success, { allowPromotion })` Independently verified. `trainCurriculum()` accepts `validateStage`; in the absence of callback Only window check left. Standard `train-curriculum.js` Always plugs in validation gate.

Final evaluation uses another set seed, non-participants validation. Moving to the next stage does not guarantee the retention of all old skills: Protection against catastrophic forgetting and replay/rehearsal Previous challenges still require separate development.

## Conservation and continuation

Files by default are in `data/arthas-curriculum/`:

- `checkpoint.json` — model/Adam/target network, Current phase, Success window and transition history;
- `report.json` — Launch results, validation, Final evaluation and memory use.

Checkpoint Update at transition, once per 100 batches and at a stop in the Ctrl+C. Resumption:

```powershell
npm.cmd run train:curriculum -- --resume=true
```

Prix `--output=...` Show the same folder. Stage configuration, The size of the window and the promotion rule must coincide with checkpoint. Old experimental checkpoint without greedy validation Reverse. Weights and stages are recovering, but replay buffer and all environments are not maintained: New episodes begin after resumption. It's not a broken line from the previous run.

B Arthas The pattern has changed: **22 sign and 12 actions**, `headless-skills-v2` / `headless-actions-v2`. Old models 16×11 Cannot be loaded as compatible. Use Exported `HEADLESS_FEATURES`, `HEADLESS_ACTIONS` Schematic identifiers, Not fixed numbers.

## Test in present Minecraft

Need local offline-server Java 1.21.1 with Survival-peace `127.0.0.1:25565`. Starting:

```powershell
npm.cmd run test:live:curriculum -- --tier=stone --name=ArthasTrial04 --minutes=8
```

The name must be new for empty equipment. In this example, six steps: Wood by class → crafting table → wooden pick → Rocket → Stone pick → Boiler. Control requires Survival And a empty start, does not issue objects or send transport teams. Cluster management, by routes and recipes.

Other profiles:

- `--tier=wood`: 3 Phase;
- `--tier=stone`: 6 Phases;
- `--tier=iron`: 14 Phases, including the shield, iron instruments, Armour and bucket;
- `--tier=diamond`: 20 Phases, including diamond instruments and armor.

For long profiles, zoom in `--minutes`, e.g. before 60. The example of the budget does not guarantee completion. Full iron/diamond-The profiles in this test were not started. User address is requested via `MC_HOST`, `MC_PORT`, `MC_VERSION`, `MC_WORLD`.

Report: `data/arthas-live/report.json`; The other folder asks `--output=...`. Start and end-of-life equipment is recorded, Steps, Action, Errors and server corrections. After the end, the agent shall be switched off. It's not a complete race to the dragon.

## Results of this assembly

[Measurements and play protocol](results/arthas-curriculum-2026-10-14.md): ArthasTrial03 implemented 6 Survival-from zero to zero 181.064 seconds. Individual DQN-Run to 512000 The transitions have been made validation The first eight stages and stopped at the furnace. Full utilization 20 Unproven.

Total API: [management v1](V1-INTELLIGENCE.md), [Types](../src/intelligence.d.ts). Definitions of stages: [stages.js](../src/learning/stages.js); cycle: [training.js](../src/learning/training.js); Game Launch: [curriculum-live.js](../examples/curriculum-live.js).
