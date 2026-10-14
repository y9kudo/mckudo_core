# Local Agent Center 0.6.0

Start from the root of the project:

```powershell
npm.cmd run dashboard
```

Panel: `http://127.0.0.1:4180`. Choose Owen, Liam or Noah in command column, connect to the server and set a tab line «Challenges». «Start» Runs brain; «Pause» Stops the current work; «Resurrection» available to the deceased agent.

- **Challenges:** Add templates, Change of parameters and order; blocks and JSON represent one line. «Apply line» Stops the previous work and throws it away.
- **Inventory:** Real slots, Quantity and equipment.
- **Learning:** Number of crossings, Balance updating, Model error and latest traffic results.
- **Management:** Survival profile, Transfer of item, Hand-held skills OMConnect.

JSON — Data format tested, Not arbitrary performance JavaScript. The normal actions are completed by confirmation of the perpetrator. Scenarios test the steps and can choose another path after failure. After six consecutive errors, the script stops for verification; button «Repeat» Returns the task to work.

The board keeps the line, finished tasks and model weight in `data/agents/`, Individual for each world and name. Annex linked to loopback, Commands protected by current process current process current and verification Origin/Host. Token is stored only on the current page. For the other world, ask `MC_WORLD` Before launch.

[Detailed management, Release format and examples](V0.6-GUIDE.md).
