# Test from empty equipment to End measurement

Version 0.5.0, The author **y9kudo**. Starting: [examples/end-expedition.js](../examples/end-expedition.js). Decisions and phases are in [src/expedition.js](../src/expedition.js), Resource logic — In the kernel. The perpetrator — OMConnect. Mineflayer No use for this launch.

## Starting

Prepare vanilla Java 1.21.1 offline Total `127.0.0.1:25565`. Requires Survival, New player without objects and armor, a normal world with resources and accessible dimensions. Use a separate copy of the world without giving out objects and teleports for reproducible verification. Don't leave the player resources during the test.

In the root OvermindMC:

```powershell
npm.cmd ci
npm.cmd run test:end:check
$env:MC_NAME = "EndRunner"
$env:MC_TEST_MINUTES = "120"
npm.cmd run test:live:end
```

`test:end:check` Checks the structure and presence of performers without entering the game. `test:live:end` It connects and really changes the world: It's mine, kraftite, Fights and builds. Limite — from 1 to 480 minutes. Ctrl+C stops launch with the report stored. The current action has its own time-♪ before 60 seconds.

Additional variables: `MC_HOST`, `MC_PORT`, `MC_WORLD_ID`, `MC_REPORT`. By default, the report is stored in `data/end-expedition.json`. For recheck **from zero** give me a new free name: The previous player retains the server inventory. The script doesn't purify him by the administrator's teams.

## Steps and confirmation

1. Stone tools and furnace: Selecting the nearest suitable wood, craft, Rock mining.
2. Iron tools and breast-breading: Ore mining, Smooth, craft; Armoured personnel is accounted for.
3. Diamond pick, 14 Osidian and light-signalling.
4. Building the frame 4×5, ignition, Observation of the active portal and transition to Neser.
5. Search for observed signs of fortress and frittes, Receive 10 rods.
6. Return to the Normal World, Mining 20 Pearls and Craft Eyes.
7. Throwing Your own Eyes, direction measurement and study of the fort area.
8. Filling **Existing** The portal and entrance to the End. Framework in Survival No crafting.

`passed` Only after all steps and server confirmation have been completed `minecraft:the_end`. Entering the End via external teleports does not replace previous steps. Death, Lack of access or end of time gives rise to incomplete/Unfavourable, Not false success.

## How to Read Report

`initial` and `final` — confirmed states; `actions` — outcomes; `checkpoints` — Completed Phases; `expedition.scenario` — Current phase and cause; `failures` — errors and delays before repetition. `fromZero` means empty initial inventory and armor. This is not proof of the absence of further assistance from the administrator. `playersObserved` Notes separately the presence of other players.

## Verification status 0.5.0

In the first minute, the agent entered empty equipment, received jungle wood, made a wooden brick and continued to search for stone. Yes 28 Action without errors and server correction. Phase `stone-tools` was not completed in a minute.

Full route to End **Not confirmed yet**. Portal performers and recovery tested by automatic tests, but requires separate game trials. The long route depends on a safe, accessible obsidian, Neser fortresses, Mobs, Submerge geometry and possibilities to return to the portal. Current policy does not guarantee the passage of any random world; The report shows the location, where further development is required. The dragon fight is not included in this measurement test.

Use it for your own application `createEndExpedition({ client, worldId })`, Start `expedition.brain.start()` And read `expedition.snapshot()`. You can pass on your valide `scenario`; The controller does not circumvent the limits of performers.
