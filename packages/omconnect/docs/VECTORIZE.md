# OMVectorize · volume navigation

Author **y9kudo**. OMVectorize it works with observed geometry: Checks the body, not just the beam between the coordinates. B 0.7-dev water A* with 26 Directions, including vertical and large diagonals.

```js
import {OMVectorize} from 'omconnect/vectorize';

const vector=new OMVectorize({
  getBlock:p=>client.world.blockAt(p),
  getRevision:()=>client.world.revision
});
const route=await vector.planAsync({
  start:client.state.position, goal:{x:12,y:62,z:9},
  airTicks:300,airReserveTicks:60,maxNodes:6000,maxDistance:64
});
console.log(route.status,route.reason,route.waypoints);
```

`client` — already connected OMConnect. In self-implementation `getBlock` Returns block from `name`, `shapes` and by the properties, `null` for an unknown world. `null` not considered air. `getRevision` allows cancellation, If the cups change during the calculation.

## How to Check the Path

- Body occupied 0,6 × 1,8 block. Partial forms of fences, plates and other blocks shall be checked by collision shapes. The fast-floating position 0,6 block not yet used.
- The entire displacement volume shall be checked between the nodes and the step to the point 0,15 block, So the diagonal doesn't go through the corner of the wall.
- Lava, fire, Cactus and other known dangers are prohibited. The water-filled solid block continues to have a conflict.
- There's a need for a visible support and a free body in the air. A water planner doesn't turn an agent into a flying player.
- Air is written off conservatively for underwater areas. Refillment is only accounted for on the full water section. `waterBreathing: true` allowed to only be asked if the effect is confirmed; The performer does not automatically assume.
- Search limited to knots/distance; Asynchronous version is less than the temporary budget cycle. She's returning `world-changed`, If the world has changed, Instead of using an outdated route.

Reasons for refusal: `invalid-start`, `air-budget`, `unloaded`, `no-route`, `search-budget`, `distance-budget`, `world-changed`. This is the data for the remodeling, Not successful in achieving the goal.

## Implementation

```js
await client.execute({skill:'swim',args:{x:12,y:62,z:9}});
```

The perpetrator shall use normal horizontal commands, rise and dive; Rechecks the passageway and the server `air_supply`. Direct entry for position not used instead of moving. If cancelled, the administration is released. Uh-huh OvermindMC Yes `agent.swimTo(position)` and JSON `{ "swim": { "x":12,"y":62,"z":9 } }`.

Air reserves are estimated conservatively, but current, damage and modification of blocks may require a new plan. The result of the action contains the local position reached; separate server package «arrival» Minecraft Doesn't send.

## Elite

```js
import {predictElytraTick} from 'omconnect/vectorize';
const next=predictElytraTick({
  position:{x:0,y:100,z:0},velocity:{x:0,y:0,z:1},
  yaw:0,pitch:-10,rocket:true
});
```

Speed is set in blocks for game tick; angles — In degrees. It's a mathematical predictive of lift power, Resistance, speed and one acceleration curve of the missile. `rocket: true` does not spend an item or send a package. Tracking of discovered elites, The duration of the missile, The landing and server correction still needs to be linked to the game performer; Autopilot not declared ready. To verify the volume of future flights, you can use `traceVolume` with appropriate body height.

Basic physics contract checked against [API entities Yarn 1.21.1](https://maven.fabricmc.net/docs/yarn-1.21.1%2Bbuild.3/net/minecraft/entity/LivingEntity.html). Precise number parameters of the pre-indicator are currently being tested by modular tests, Not by measuring the flight on the server.
