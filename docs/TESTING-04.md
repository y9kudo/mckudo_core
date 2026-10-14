# Checks OvermindMC 0.4.0

## Independent client and adaptation — 28 September 2026

- OMConnect v0.1.0 packed and attached to a separate annex. Imports `mckudo` and `mineflayer` It's not accessible; customer, Group from 10 Facilities and ballistics are operational.
- Real Minecraft Java 1.21.1: Alice/Blake And a group of seven clients got cups/Position, Exchanged messages and selected the same artist. Group 7 — 49 Delivery, 0 chat-Packages.
- Group of 10 entrance checked twice: server reports `players.max = 8` And turns away Henry with `multiplayer.disconnect.server_full`. All previously in-house clients close. Ten simultaneous games are not confirmed yet.
- Alice through the updated independent client, she obtained and picked up one log; The server equipment grew with 0 to 1, No traffic correction.
- Model tests: operator output without catalog, withdrawal after failure, new effect, Experience planning, change of strategy without changing target, TTL/duplicate intentions, Liquids/Special surfaces, ballistic pre-emptive, Rescission of onions and confirmation of crossbow discharge.
- Special surfaces, Arrow hit, Combustion/The new client's full-time gelium is still not confirmed. Decoder warning `declare_recipes` stays open.

Summary: [independent-2026-09-28.json](results/independent-2026-09-28.json). The raw reports are in a ignored folder `data/`.

## Automatic checks

At Node.js 24.19.0 Under Windows configuration and configuration checks performed 130 tests, including 14 Self-tests OMConnect. The old rules are checked, Workflow, GoalBrain, memory, runtime and bridge, and new scenarios:

- All 1060 Register blocks 1.21.1 Receive classes; leaves and deep ores retain parental marks.
- Wooden kirk is planned from acacia without oak; Objective `#planks` Selects the board available.
- The normal and deep iron ore is compared with the same raw and suitable instrument.
- A* Overcoming Barriers, Compliance with budgets, requires a known support and does not accept an unknown cell for air.
- The bridge is only planned with sufficient material; Test performer confirms block before next motion.
- Mining is cancelled when threatened; The attack begins after the cancellation is completed, try Workflow retained.
- Nutrition picks ready food, mature culture or permitted mining; Players excluded from hunting.
- The coptile cooking checks the exit and closes the window.
- The perception uses new radii, Checking for the jar and dropping the cache; Emergency check does not repeat the scan of the blocks.
- Resource Reactor Renovating the decision on the current inventory, Research excludes visited points.
- Importer JAR/ZIP Reads data without extracting files and rejects damaged boundaries.

`demo:library` in model 34 and building 97 shelter blocks; At least it's a tree's wind, wood/Stone/Rail instruments. `demo:navigation` == sync, corrected by elderman == @elder_man. Verification TypeScript The main new developments in the field of transport and transport API and Imports Mineflayer-adapter.

Play Commands:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run demo:library
npm.cmd run demo:navigation
```

## Data completeness 1.21.1

Register taken from `minecraft-data`, The recipe and tag files are read from the local installed Java 1.21.1. [Import report](results/catalog-1.21.1.json): 1060 blocks, 1333 item, 1290 prescription, 184 package tags and 147 item tags. Uh-huh 990 Records are a supported model of performance. All other entries are also indexed with the source data and the reason for the absence of the performer.

Catalogue check confirms the existence and consistency of records. It's not a game-working recipe.

## Game tests

28 September 2026 Local Time Year vanilla 1.21.1 First tests performed **OMConnect without Mineflayer**:

- Offline-Incoming, Collection of coordinates, Health, equipment and jar.
- Mining guns through the classroom `#logs` and selection: The server confirmed the destruction, The log appeared in the inventory.
- Self-movement along a short route; The server did not send any position correction in successful tests.

Initial rebound failed: The route was built for a falling object in the air. After correction, the performer selects an achievable support near the subject and confirms receipt of the equipment. [Report OMConnect](results/kudoconnect-1.21.1.json).

In the same session, the old script Mineflayer reached the wooden curly, Then stopped after three mistakes in finding a path/Rock-stage selection. This run is not considered to be passing Minecraft. Game confirmations of shield fight, Total Nether/End-There is no way and no dragon dies. Model tests cover the choice of tactics, cancellation, Triangulation, Portal frame and no false victory.

The server has a bug in the package selection `declare_recipes`. It's saved in the report; Current inspections OMConnect Don't use this craft bag. Details and current limits of the playwriter — in [OMCONNECT](OMCONNECT.md).

### Previous tests

22 September 2026 Year vanilla 1.21.1 separate early implementation test 0.4: empty equipment → Oak mining → boards → Installation of the cerstack → Sticks → wooden pick. Implemented 10 confirmed actions. [Report](results/vanilla-1.21.1-04.json).

After adding new classes, navigation, bridges, server power and interruption `127.0.0.1:25565` rejected connection (`ECONNREFUSED`). These new capabilities in this launch are tested by automatic tests and models API; A new game run is still required. Previous success of mining/craft is not counted as testing new tools.

Full house, Iron and smelting, movement/Bridges, Farm, Hunting, Protection and long-term survival should receive separate reports from Minecraft. Full passage to the Dragon of the Province is planned for next integration scenario; Winning has not yet been confirmed.

## Next game test procedure

1. Run Yours vanilla-server 1.21.1 and select a location for agent action.
2. Check the source of wood, Free station cell and initial equipment.
3. Start `demo:resources:mineflayer`: Receive wood curry from accessible wood with protection and nutritional responses.
4. Check separately `navigate` flat ground, Then get up/the descent and the two-block break with the actual bridge material.
5. Checking mature culture and replanting at their site; separately — Cooking in an empty furnace/Coptilene.
6. Check the cancellation of the production in the mobe and stop the movement. PvP-include only for a specially selected test.
7. Maintain observed equipment, Change of blocks, results and errors. Death/The test stops and records the cause.

Test application connects Minecraft; OvermindMC remains imported core. Model tests, Data completeness and game results are recorded separately.

## Installation of the package collected

Archives `mckudo-0.4.0.tgz` specified in a separate annex. Public imports of kernels and adapters verified. By full catalogue 1.21.1 Model chain from 21 Action: Acacia + Rock + Deep Iron Ore → Iron pick. The result is confirmed by the state of the individual simulator. [Audit summary](results/verification-04.json).
