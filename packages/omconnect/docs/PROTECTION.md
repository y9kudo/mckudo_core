# Building protection

Creator: **y9kudo**. The module works independently inside OMConnect.

```js
import { createOMConnect } from 'omconnect';

const client = createOMConnect({
  username: 'Harper', host: '127.0.0.1', port: 25565,
  version: '1.21.1', auth: 'offline',
  protection: { regions: [{
    id: 'home', dimension: 'minecraft:overworld',
    min: { x: 10, y: 60, z: 20 },
    max: { x: 30, y: 90, z: 40 }
  }] }
});

await client.connect();
client.on('protectedEdit', e => console.log(e.operation, e.position, e.reason));
```

Replace the angles with the coordinates of your home, including the roof and basement. Boundaries included in volume, The fractional coordinates shall be rounded down. Walking inside is allowed, Production and production prohibited. Before 128 Areas. `client.protection.add(region)` Adds or replaces a field by ID, `remove(id)` Remove, `regions` Returns the copy. Keep configuration for your next connection; Every client has a policy.

By default `structures:true`, `structureRadius:2`. Board, Rocket, bricks, doors, glass and functional units protected as building signs; The surrounding natural blocks in this radius are not being mined either. Leaves, Breeves and ores are not signs of home in themselves. Such heuristics do not define the owner and may preserve the natural structures. Natural materials house should be protected by a clear area.

`structures:false` Only turns off the euristic; Areas continue to work. `structureRadius` — an integer 0–3. Confirmed own installations can be taken outside the field; to 4096 Records, server update cancels entry. This memory belongs to the current client's copy.

Installed `dig`, `gather`, clearance `navigate`, `place`, Bridges, `pillar`, `descendPillar`, The installation of the bed and the changes in portals are checked by the security. `excavate:true` Doesn't bypass the ban. The checks shall be repeated after turning and before the production is completed. The server package cannot be cancelled. Reading a chest and using a bed are not prey/The design and regulation of the annex separately.

For your own skill, Who writes directly packages:

```js
const decision = client.protection.check({
  operation: 'dig', dimension: client.state.dimension,
  position: { x: 15, y: 64, z: 25 },
  getBlock: p => client.world.blockAt(p)
});
if (!decision.allowed) throw new Error(decision.reason);
```

`OMProtection` and `isStructureBlock` Exported for external planners. Net `planRoute` / `planRouteAsync` not attached to a client: Pass it `canDig(block,position)` and `canPlace(position)` for own policy. It's a client restriction, Not server protection against outsiders or user network skills.
