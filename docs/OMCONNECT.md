# Connect the kernel to Minecraft

**OvermindMC + independent OMConnect · Created by y9kudo · MIT**

OMConnect owns the server session, received chunks, entities, inventory, physics and action execution. OvermindMC owns goals, resource dependencies, survival policy, cooperation and learning. The optional adapter translates between their contracts. Neither library requires Mineflayer; a separate Mineflayer adapter remains available for existing applications.

## Minimal application

The core package bundles OMConnect through `overmindmc/connect`. The standalone client archive exports the same API from `omconnect`.

```js
import {createOMConnect} from 'overmindmc/connect';
import {createMinecraftBrain} from 'overmindmc';

const client=createOMConnect({
  username:'Atlas',host:'127.0.0.1',port:25565,
  version:'1.21.1',auth:'offline'
});
let brain;
try {
  await client.connect();
  await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
  brain=createMinecraftBrain({client,worldId:'my-world',survival:{targets:{'#logs':4}}});
  for(let i=0;i<100&&brain.survival.snapshot().status!=='completed';i++)await brain.tick();
} finally {
  await brain?.stop();
  await client.close();
}
```

For class-independent completion and bounded application runs, prefer `createMinecraftAgent().get('#logs',4)` as shown in [the planning guide](PLANNING.md). Low-level applications decide when to stop their loop. A continuously running application can call `brain.start()` and handle process shutdown by stopping the brain and closing the client.

## What the client guarantees

- Unknown chunks remain unknown. Movement and editing use the observed world, collision shapes and permissions.
- Inventory and confirmed world changes establish results; sending a packet is not success.
- Actions are bounded and cancellable. One physical executor owns ordinary inputs; urgent defensive policy can preempt work.
- Block interactions evaluate multiple standing positions through a shared spatial search. A validated route can be consumed once without repeating the search.
- Read views track the observed sections they depend on. Surface edits do not automatically invalidate an underground route in another section; relevant edits, chunk replacement/unload and dimension changes still invalidate it.

## Version and application boundaries

Native high-level gameplay profiles cover Java 1.21/1.21.1. A known codec or item catalog does not establish full gameplay support on another version. Use [the version API](VERSION-API.md) to inspect capabilities and register experimental profiles.

The client advertises executable skills through `describe()`. A catalog can know a recipe even when a custom adapter does not implement its machine. Modded servers require their appropriate bridge, catalog and executors.

[Independent client API](../packages/omconnect/docs/API.md) · [Physics](../packages/omconnect/docs/PHYSICS.md) · [Scenarios](SCENARIOS.md) · [Quality policy](QUALITY.md).
