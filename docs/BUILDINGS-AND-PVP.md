# Construction, navigation and combat

OvermindMC Selects resource and tactics, OMConnect Checks and executes the action. Building protection is in the client's own location and works without OvermindMC. It's default for built-in skills.

## What Changed

The agent shouldn't be getting a wall from the house for a short route or taking a wooden beam for the nearest tree. Before clearing the route and the usual mining, the customer checks building signs and protected areas. Resource brains rule out such sources when they pick wood or ore. If there's no bypass, The action indicates error; Resolution `excavate:true` does not disable the protection.

Lateral throwing near the wall after reset: The verification of the players &apos; bypass is limited to the distance to the current stop point. Geometry behind this point no longer rejects the allowed short movement back. The final position of the full tracker is checked even between the intermediate reports of the corridor.

Automatic checks count boards, Rocket, bricks, glass, doors, stairs, beds, Warehouses and workstations. The natural block within two blocks of such a topic is also not mined. Brooks and leaves are not considered as a building in themselves: The usual birch remains a class source `#logs`.

It's conservative heuristic: It can preserve natural structures and stones near the station. The unit cannot be identified with reliability by network updates. For a house from the ground, Rock or separate logs, give the area clearly. The boundaries of the area are included in defence, The coordinates shall be rounded down, The measurements shall be checked separately.

## Protect Your Home

For the project, using OvermindMC from source:

```js
import { createMinecraftAgent } from './overmindmc.js';

const agent = createMinecraftAgent({
  name: 'Harper',
  worldId: 'my-survival-world',
  connection: {
    host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline',
    protection: {
      regions: [{
        id: 'my-house',
        dimension: 'minecraft:overworld',
        min: { x: 70, y: 60, z: -120 },
        max: { x: 90, y: 85, z: -100 }
      }]
    }
  }
});

await agent.start('wood');
```

`min` and `max` — The opposite angles of the size of the house. Turn on the walls, roof, basement and small reserve outside. For group, give the same settings `connection` to the agent manager. Every customer has a policy; The change of one copy does not change the rest.

In self-standing OMConnect Setup is directly transmitted to `createOMConnect({ protection: {...} })`. For an established library OvermindMC imports used `mckudo` and `overmindmc/connect`; for self-contained — `kudoconnect`.

## Change Areas during Work

```js
agent.client.protection.add({
  id: 'farm', dimension: 'minecraft:overworld',
  min: { x: 95, y: 60, z: -110 },
  max: { x: 110, y: 80, z: -90 }
});

console.log(agent.client.protection.regions);
agent.client.protection.remove('farm');

agent.client.on('protectedEdit', event => {
  console.log(event.operation, event.position, event.reason);
});
```

Re-schedule `add` with the same ID replaces area. Maximum — 128 Areas. `regions` Returns the copy. Changes during work live in the current client: Keep them in your own JSON-configuration, If you need them after restart.

In the region, you are allowed to walk, To watch and fight. Intended actions do not produce or plant blocks, including bridges, Poles, beds and parts of portals. The mining re-checks the resolution after the turn and before the end package; The ban that has appeared cancels the continuation. Unable to cancel the server-processed change.

The defense doesn't manage the opening of storage facilities, the transfer of objects or the use of the existing bed. Set these policies separately. It's a client rule, Not a server plagin: The personal skills with direct recording of network packages should be self-made `client.protection.check(...)`.

## Own building blocks

Client memorizes before 4096 approved own facilities. They're allowed to be taken apart, If they are not in a clear protected area. After the server upgrade of the block, this mark is removed. The memory is not transferred to another agent or a new copy of the client.

If the application needs a complete classification of the buildings, `protection: { structures: false, regions: [...] }` Only turns off the euristic. Clear Areas Continue to Work. `structureRadius` it sets the radius of heuristics 0–3; default value — 2.

## PvP and Prosecution

Response to a standard profile player OvermindMC Under-still requires two confirmed strikes; Trusted players are excluded through `defense.trustedPlayers`. Shield, Weapons reconstruction, change in axe against active shield and normal jump for critical impact are taken into account by the performing officer. [Official description of the role of the axe in combat](https://www.minecraft.net/fr-ca/article/taking-inventory--axe).

The fighter uses short-term measures to circumvent the obstacle A* by observed blocks: to 1600 knots, distance 16 blocks, Drop by one block, maximum. He doesn't dig or build bridges. The route is still in motion 800 ms and reverified when changing the world or the goal position. The available step is overrun by a simple jump with client physics.

Progress in the pursuit of the fight between short-term personnel. Walking in circles is not considered a convergence. No convergence within three seconds or after 15 no-reverse-impact pursuit seconds cease. The radius from the meeting point is limited to double `maxDistance`. A hit that was sent is not considered to be a confirmed damage. A single target error does not create a general pause for all hostilities.

Standard brain for five seconds excludes a target from a choice, to protect yourself from another enemy. :: De-positioning of agent or target into two blocks, Change of measurement or new confirmed impact allows for a review earlier. In the event of poor health and risk, the limit does not suppress the decision to leave. For my own `createCombatReactor` Off-the-brain plug in `reactor.attach(core)` or transmit the outcome to `recordResult`.

Fight and walking use the same server limitations: unknown cups are not considered empty, Impact range not increased, coordinates not teleported. These changes do not confirm victory over the dragon or universal force in the PvP.

## Checks

```powershell
npm.cmd run check
npm.cmd run test:live:protection
```

The first launch checks the routes around the house, Wood beam protection in wood search, Prohibition of bridges, Production cancelled under new ban, The roundabouts in battle, Step-up and independence of error of different objectives. The second connects one client to the offline-server Java 1.21.1, Checks for non-change within the temporal area and conducts a short route without mining. Report maintained locally in `data/protection-live.json`.
