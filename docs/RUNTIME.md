# Several agents

OvermindRuntime coordinates several independent copies of the kernel in one process. Everyone has their own observations, memory, Tasks and adapter. concurrency limit the number of simultaneous steps.

~~~js
import { createCore, OvermindRuntime } from 'overmindmc';
import { createSimulator } from 'overmindmc/adapters/simulator';

const runtime = new OvermindRuntime({ concurrency: 2 });
runtime.add(
  'north',
  createCore({ config: northConfig, adapter: createSimulator() }),
  { resourceKey: 'simulation:north' }
);
runtime.add(
  'south',
  createCore({ config: southConfig, adapter: createSimulator() }),
  { resourceKey: 'simulation:south' }
);

await runtime.tick();
console.log(runtime.snapshot().agents);
await runtime.stop();
~~~

northConfig and southConfig — Self-contained configurations. Full example launched: examples/runtime.js.

Runtime.tick() One step each agent with parallel limits. Repeated simultaneous challenges are joined together. Automatic timer runtime no: schedule sets the application. Don't call for controlled agents core.start() — Otherwise, independent cycle will pass the limit runtime.

## Identification of the game resource

resourceKey — A stable connection or character identifier, Agent-controlled. Two identical keys or one copy core Not allowed twice. default key is ID agent.

The kernel cannot identify, That two different adapters inside are controlling the same juice. For real connections, pass the same thing resourceKey for one physical resource. The test works inside one runtime; No distributed blockage between processes yet.

## Stop

await runtime.pause() Requests cancellation from all agents and does not start the remaining steps in line. runtime.resume() takes a pause. runtime.stop() completes the current package by abolishing. The steps already completed are still in place.

Runtime does not close the games: The application owns them. If the other skill ignores AbortSignal, Stop pending its completion — It's the same contract, I think it's a separate kernel.

Add and remove agents available between the steps. remove(id) Returns the copy core. snapshot() returns a copy of the general state.

It's a logical coordination, Not a distributed cluster and not a performance guarantee for thousands Minecraft-Clients. The loading of the game tests are still pending.
