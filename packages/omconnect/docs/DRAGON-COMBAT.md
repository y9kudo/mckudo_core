# The Middle War with the Dragon of the Kraj

When a dragon gets on the portal, OvermindMC can cause skill OMConnect `attackDragon`. The client finds the head relative to the body observed and the turning, Takes the sword, Waiting for the attack to rebound and hitting the part «head». In a safe environment, he jumps and tries to strike in the fall. The reply contains `damageConfirmed` on the occasion of the loss/and separate health-related issues `criticalAttempted`. The last field reports an attempt at criticality, Not proof of the multiplier of damage.

```js
const dragon=client.observe().entities.find(entity=>entity.name==='ender_dragon');
if(dragon && [5,6,7].includes(dragon.phase)) {
  const result=await client.execute({
    skill:'attackDragon',args:{entityId:dragon.id,critical:true}
  });
  console.log(result.damageConfirmed,result.criticalAttempted);
}
```

Skills requires Minecraft Java 1.21.1, Sword in inventory, Observed head within impact and free line before. He's not taking an agent to the dragon: Use it for full behavior `createDragonPolicy({client})` from OvermindMC, who picks up the support and route. If phase changed, Head's gone from reach or the route is closed, Cancellation. [Game result](https://github.com/y9kudo/mckudo_core/blob/main/docs/results/dragon-melee-2026-10-13.md) is related to the combat prepared, not to go from scratch.
