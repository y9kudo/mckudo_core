# Checks OvermindMC and OMConnect 0.5.0

Date issued: 2026-09-30. Author: **y9kudo**. Results refer to specific audits, Not to all possible worlds Minecraft.

## Automatic checks

General launch `npm.cmd run check`: **203 Test passed, 0 Errors**. Core checked, Planners, scenarios, exchange, server equipment confirmation, craft, Physics, traffic, Fall estimates, Measurement transition processing and portal operation. Audit of public TypeScript-The interfaces were also passed.

The measurements shall be repeated by the protocol events. The model achievement of a diamond kit is not equivalent to passing through the present Minecraft.

## Game trials: vanilla Java 1.21.1, offline

| Verification | Confirmed | Conditions |
| --- | --- | --- |
| Movement | Diagonal, sprint, a smooth look, Three separate agents | 0 server correction in the route to be checked |
| One block descent | Successful sand descent; Loss of health 0; adjustments 0 | Real coordinates and health before/after |
| Warehouses | Search and read chests, double chests, barrels, Shakers | The items were prepared by the person |
| Distribution of equipment | Owen, Liam and Noah received and provided full iron kits | Corrected by third player intercept and too close |
| Sleep | The server confirmed the dream Owen In the bed to be laid | The pass is not confirmed all night: The other players weren't sleeping |
| Diamond kit | Three agents gathered kits in the previous run | Resources included the dead player's lute; This is **Not from zero** |
| The expedition to Enda | A Blank Start, The jungle wood, wooden pick, Further study | 1 minute, 28 actions, 0 Errors, 0 adjustments; Status `incomplete` |

Hunting, Craft of the wool bed, The full passage to Ande and victory over the dragon have not yet been fully confirmed. The bed was ready for sleep. Armour/Items from the test chest are not issued for self-mining.

## Repeat

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:end:check
npm.cmd run test:live:fall
npm.cmd run test:live:daily
```

Playing teams require servers and change the world. Long test: [Expedition instruction](END-EXPEDITION.md). `data/` contains local detailed journals and is excluded from Git. In public [Summary report](results/verification-05.json) left only the necessary results to assess without local chat logs and player tools.

Historical results 0.4 retained separately; their limitations do not replace current checks. GitHub Actions start automatic checks on Windows/Linux and Node.js 22/24; game server in CI not started.
