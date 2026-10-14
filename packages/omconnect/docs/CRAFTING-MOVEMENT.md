# craft, and reconstruction

## Construction under construction

`await client.execute({skill:'pillar',args:{count:3,block:'dirt'}})` Raises the agent to three blocks by just jumping. Need full support, Health better 8, free space and materials. Count — 1–8; without `block` The normal full cost blocks are selected. Every step is confirmed by a change in the world, and planting. Position correction terminates.

`await client.execute({skill:'descendPillar',args:{count:3}})` Clarifys its own confirmed pole in one block. A known safe support under each removed block is required. Reconnected Post-delayed Post not stored. Normal `dig` prohibited under your feet.

`evade` accepts `{from:{x,y,z}}` And takes a certain route of escape. Shots fired `shoot` smooth target; Close crystals and sitting dragon phases are repelling. `client.endgame` Keeps the explosion confirmations/Crystal removal and dragon death, Separately indicate the presence of the agent &apos; s server damage.

OMConnect contains the perpetrators Minecraft Java 1.21.1; The choice of long-term goals belongs to the brain involved. Author — y9kudo.

```js
import {createOMConnect} from 'omconnect';
const client=createOMConnect({username:'Oliver',auth:'offline'});
try {
  await client.connect();
  if(client.state.status==='dead')await client.respawn();
  await client.execute({skill:'gather',args:{block:'#logs',count:1}},
    {signal:AbortSignal.timeout(60000)});
  await client.execute({skill:'ensureStation',args:{station:'crafting_table'}});
} finally {await client.close();}
```

`craftingRecipes(registry, item)` Shows the static prescriptions being fulfilled. `chooseCraftingRecipe(registry,item,inventory)` Selects scrap material to account for residues. `craft.count` means new number of results, Not the quantity in the final inventory; A party can give more. Mixed boards are only allowed for prescriptions with appropriate tag, Special wooden items retained. Re-carrying and special dynamic prescriptions are not yet implemented.

craft 2×2 Works in inventory, 3×3 Opens the doors. The perpetrator awaits server responses to the movement of ingredients and the result. Cancel Closes Window; confirmed changes do not roll back.

`ensureStation({ station: 'crafting_table' | 'furnace', gather: true })` — The arguments of the same skill. First, we're looking for an accessible station, then the basic materials are collected, Creates an object and checks the production. `gather:false` Prohibits additional mining.

`smelt` accepts `item`, `count` 1–64, Non-binding `input`, `fuel`, `fuelCount`. Normal ores supported, Wood coal, Basic food and basic building results. `smeltingRecipe` Returns supported raw materials and time; `fuelItems` — Number of remelts per fuel. Existing items are not consumed in the furnace. Parallel clients in one process wait for the furnace to be released. Pass enough time-Out: The usual thing melts for about ten seconds at the 20 TPS.

`lookAt` does not teleport angles to target: The twist is performed by physical ticks. `waitForLook` Pending completion, `cancelLook` cancels target. `turnSpeed` in degrees/One second (30–1440). Immediate turn is clearly available through `immediate:true`.

`navigate` Consists of direct steps, Sprint at sufficient hunger, Jumps on a long, verified area. Jump not applied blindly above unknown support. Arguments `sprint:false`, `sprintJump:false`, `bridge:false` Disable the relevant parts on the same route.

`excavate:true` Allows the clearance of normal soil and stone along the route, including step ceiling. Need a tool, to produce drip; unknown areas, Liquids and nearby falling blocks prohibit such clearance. No support under current and next position is mined. Approach to the station/The target block first checks the normal routes and then this possibility of exit from the output. User A* includes mining through `canDig(block, position)`; The performer confirms each unit removed.

Searching takes into account the changes in each branch of the plan: The removed block becomes air, Bridge built — Support. The world's different changes distinguish the state of search. Therefore, the future step cannot be based on the previously dug block. Clearance limited 32 block on one route; Long-term development, with several new surveillance actions.

`bridgeMaterials` Selects safe, complete blocks from inventory. Land, Rock, boards, wool and concrete may be used jointly. Falling, functional, Dangerous and valuable blocks excluded. Client Options `bridgeReserve` and `bridgeItemValue` set the reserve and the cost of the consumption. The server must confirm every new block before crossing.

Searching Sees Your Cups, Not the whole world. Uniform and multi-digit sections miss out on the wrong amounts. `truncated:true` means incomplete search. For Java 1.21.1 use a separate corrected decoder of the prescription list: [Reference correction minecraft-data](https://github.com/PrismarineJS/minecraft-data/pull/1291). Global data and caches of transport unchanged.

Death `status` becomes `dead`, Cancellation. `respawn()` Requests a revival and awaits a new living state. Outside of death, he's repelling. For new connection after `close()` I need a new client.


## Searching for a path without blocking event processing

Indirect `navigate`, mining and looking for a lute approach `planRouteAsync`. Public Example:

```js
import { planRouteAsync } from 'omconnect';
const view = client.world.createReadView();
const route = await planRouteAsync({
  start: { x: 0, y: 64, z: 0 }, goal: { x: 10, y: 64, z: 0 },
  getBlock: p => view.blockAt(p), maxNodes: 3000,
  signal: new AbortController().signal
}, { sliceMs: 2, nodesPerSlice: 64, getRevision: () => view.isCurrent() });
```

`client` — connected OMConnect. The overall turn of the process alternates the search: soft overall budget 4 ms, one search portion before 64 knots or 2 ms. The individual node is treated in its entirety. The change in the cup read rejects Promise; External updates are not prevented. Synchronous `planRoute` available. The route found does not yet mean the movement. The actual turn can be created through `createWorkScheduler({budgetMs,maxJobs})` and to put the second argument as `scheduler`.

`client.snapshot().metrics.timing` contains `effectiveHz`, `meanIntervalMs`, `p95IntervalMs`, `maxIntervalMs`, `delayedTicks`, `samples`, `ticks`. Window — 128 Last local timer intervals; Persons detained are considered to be longer than 75 ms. It's not networked ping and not server TPS. The estimates are equal before the intervals are accumulated `null`; Last statistics retained after deactivation.

`metrics.navigation` contains the total statistics of the number of all clients in the process: Waiting, Completed, mistakes and cancellations, number of meals and maximum time. `createWorkScheduler.submit()` Accepts synchronic iterator, Supports `signal`, Size limitation and clearance on cancellation. This is the timing of the event cycle, Not a hard-core limiter CPU.
## Bridges and intermediate routes 0.6.0

`planRoute` / `planRouteAsync` Accept `allowPartial: true`. Plan `status: 'planned', partial: true` contains the verified intermediate `target`; The application needs to go through this section and count the path. The partial result is default off. Unknown blocks do not become air or support.

During `navigate` Bridge spends safe, complete, stationary equipment blocks. The perpetrator shall sit down, Confirms the fixed support and the reduction of the amount of material before step, keeps the edge in physics and turns off the seat when canceled. Sand, gravel, Valuable blocks and stations are not used by accident. Automatic extraction of missing material achieves a high-level objective OvermindMC; independent OMConnect the application transmits material already prepared.
