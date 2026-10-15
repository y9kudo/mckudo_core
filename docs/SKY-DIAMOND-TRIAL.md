# A diamond above a flat Survival world

This trial gives the core one inventory goal: `{'minecraft:diamond': 1}`. The example does not contain an ordered crafting route or fixed ore coordinates. The survival reactor resolves tool/recipe prerequisites from the connected world's catalog and current observations. The core's elevated-access policy plans construction stock, a side column and a drop-catching platform; OMConnect executes ordinary movement, jump-placement, mining and collection.

## World preparation

- Java 1.21.1 offline server; the agent must enter Survival with an empty inventory.
- A floating diamond ore block in received chunks, with a known clear side column and ground support. The current policy bounds the rise to 128 blocks.
- Sources for three iron ingots, wood, cobblestone and furnace fuel. In a superflat fixture, three supplied iron ore blocks and a village can supply the intended chain. The example never grants items or uses administrative world-edit commands.
- Set `MC_ALLOW_VILLAGE_MATERIALS=1` when this test permits harvesting the village's building materials. This disables automatic structure protection only for this client. Other clients keep their normal policy; explicit protected regions still apply.

```powershell
$env:MC_HOST='127.0.0.1'
$env:MC_PORT='25565'
$env:MC_NAME='RowanSky'
$env:MC_WORLD='local-sky-diamond'
$env:MC_ALLOW_VILLAGE_MATERIALS='1'
npm.cmd run test:live:sky-diamond
```

Use a new `MC_NAME` for a fresh inventory. To continue the same world/agent after a development restart, keep the same environment variables and run:

```powershell
node examples/sky-diamond-live.js --resume
```

Resume retains the original initial inventory and action journal. It does not reset Minecraft or manufacture lost resources.

## What the core does

For an observed floating mineral source, ordinary walking is insufficient. The policy chooses a fully observed side column, obtains enough expendable full blocks for the entire remaining rise plus a catch block, and approaches its base. Soil procurement stays at the staging ground level so collecting dirt does not cause an ever-deeper pit.

Ascent uses existing `pillar` actions in batches of at most eight verified placements. Two blocks below the ore, the agent can see its underside and attach a catch block. It then finishes the side column, mines with a suitable tool and collects the real dropped item. This keeps the drop above a full support instead of letting it fall to ground level. Unknown geometry, protected cells, occupied columns and insufficient materials can stop or change the plan.

The example records `data/sky-diamond-live.json`. `current.plan.plan` shows recipe dependencies; `current.plan.elevatedAccess` shows the chosen column, staging height, target and remaining block budget. `pillarSteps` records confirmed landings, and `actions` records crafting, smelting, mining and pickup outcomes. Raw reports remain local and ignored by Git.

A pass requires all of the following: a confirmed iron-pickaxe craft, a confirmed diamond-ore mining action, at least one verified pillar placement and at least one diamond in the authoritative inventory. Planned actions or a vanished ore block alone cannot pass the trial. The agent remains connected after completion for inspection.

To pause or stop it, write one of these commands to `data/sky-diamond-control.json`:

```powershell
'{"command":"pause"}' | Set-Content data/sky-diamond-control.json
'{"command":"run"}' | Set-Content data/sky-diamond-control.json
'{"command":"stop"}' | Set-Content data/sky-diamond-control.json
```
