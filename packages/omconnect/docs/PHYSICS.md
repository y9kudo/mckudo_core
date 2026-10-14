# Physics and targeting

`stepPhysics` — A limited player's own integrator Java 1.21.1. One call matches one game tiki 50 ms. Source of True Health, items, and position correction — server.

Basic contacts: hardness blocks, Liquids, stairs, Web, honey, mucus and slippery surfaces. Unknown cups prohibit movement. `environmentAt` Returns Wednesday, support, friction, Contact points and danger; lava is never considered air. Flows are calculated by observed neighbouring levels, So the unknown neighbor doesn't generate a fictional stream. The web is losing momentum, the mucus reflects the fall (Except sneak), honey slows and reduces jump. It's a basic model; Navigation, effects, ♪ Charms, Moving pistons and transport require additional profiles.

The numerical factors were checked at the open [implementation Prismarine Physics](https://github.com/PrismarineJS/prismarine-physics/blob/master/index.js) and [branch NeoForge for 1.21.1](https://github.com/neoforged/NeoForge/blob/1.21.1/patches/net/minecraft/world/entity/LivingEntity.java.patch). They're not being tested as a substitute for game comparisons: Special surfaces have been tested by model tests so far, and the normal traffic was further checked on the server.

## Ballistics

```js
import { solveAim } from 'omconnect';
const solution = solveAim({
  origin: { x: 0, y: 65.52, z: 0 },
  target: { x: 24, y: 65, z: 0 },
  targetVelocity: { x: 0, y: 0, z: 0.1 }, // block by game tick
  weapon: 'bow', chargeTicks: 20,
  getBlock: position => client.world.blockAt(position)
});
```

The decisionr is looking for a trajectory intersection with a moving target, Checks the exact intersection of the blocks and refuses to follow an unknown path. Target speed is considered constant on a short horizon. Parameters `bow`, `crossbow`, `trident` set reference speed, Resistance and gravity. A numerical result — projection without accidental dispersion; acceleration of target, Water or a changed world can make it wrong.

`yaw` and `pitch` issued **Network degrees Minecraft**, positive pitch Heading downward. `targetVelocity` and `inheritedVelocity` — Stick blocks, Not in a second. `traceProjectile` Returns the way or first obstacle. `solveAim` Doesn't shoot: Use this for real action `client.execute({ skill: 'shoot', args: { entityId, weapon: 'bow' } })`.

The perpetrator counts the target at the fresh position before firing. It's holding up the tension/charging, Checks munitions and waits for a server to confirm the flow/Projectile. Cancel the onion on the bow changes the slot, Don't let the arrow go to the old target. `shotServerConfirmed` and `hitConfirmed` different: The release in this version is not confirmed.

Structure `charged_projectiles` cross-bow checked by [protocol 1.21.1](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.21.1/proto.yml). The perpetrator shoots with ordinary arrows; Fireworks and actual trench throws are not yet implemented.
