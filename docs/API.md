# OvermindMC API · Arthas beta2

Public entry point: `overmindmc`. Main exports include `createCore`, `OvermindCore`, `OvermindRuntime`, `definePlugin`, `validateConfig`, `ConfigError`, `matches` and `OVERMIND`. See [Navigation V2](NAVIGATION-V2.md) for spatial planning, [World Intelligence V2](WORLD-INTELLIGENCE-V2.md) for the atlas/exploration and [Cognitive V2](COGNITIVE-V2.md) for decisions, plan repair and controlled evaluation. [Task Orchestration V2](TASK-ORCHESTRATION-V2.md) describes dependency queues, durable action hooks, memory recovery and lifecycle controls. [Perception V2](PERCEPTION-V2.md) covers change evidence, entity budgets and combat diagnostics.

Catalogue, Block classes, Prescriptions, routes, research, Reactor, Food and construction described in [AUTOMATION.md](AUTOMATION.md). The full list of signatures is in [overmindmc.d.ts](../overmindmc.d.ts).

## One agent

~~~js
const core = createCore({ config, adapter, memory, planning, reactors, preemptionMs: 100 });
await core.tick();
core.start();
await core.pause();
core.resume();
await core.stop();
~~~

config — Read result JSON or a common object. adapter implemented describe/observe/execute. memory optional. planning required when available goals; see. [Planner](BRAIN.md). clock — Non-mandatory time function for determinable tests.

tick() Conducts one observation cycle → choice → Action. Simultaneous calls use a common lock. start() includes automatic cycle; interval begins after the previous step. resume() takes a pause, but does not start a separate timer, If start() not used.

## Contract for cancellation

Time-Out, pause, stop and urgent Reactor Transmitted AbortSignal. The adapter has to actually stop and complete Promise. The kernel does not start another task before this confirmation. If skill ignores signal, Waiting can continue; The library can't force the arbitrary flow of play. `observeThreats` — non-mandatory fast read-only adapter method for urgent reactions. It can be called during action, must be completed upon abolition and must not change the world. Used without it `observe`.

## Observation

snapshot() Returns the copy:
- observation — Last confirmed observations;
- decision — chosen rule or step and alternatives;
- workflows — progress in the tasks;
- plugins — Skills sets connected;
- history — Recent results;
- listenerErrors — Last ten subscription errors;
- brain — Status of objectives, challenge plan and budget;
- trace — Final course of decision;
- engine — Version and Authorship OvermindMC.

Under normal rule observation — Photo before action. At step c until It is updated after action to verify the result.

~~~js
core.on('state', snapshot => render(snapshot));
core.on('action:start', decision => log(decision));
core.on('action:finish', result => persistResult(result));
~~~

Status events isolate subscription errors, including rejected Promise: An interface error does not change the result of the game action. Subscribers receive separate copies of data. Their asynchronous operations do not delay the game cycle; if confirmed retention is required until next action, Call tick and keeping it in sequence.

Results: success, failure, cancelled and progress. Last means, I'm sure the action was done, but until Not yet achieved.

## Memory

~~~js
import { FileMemory } from 'overmindmc/memory';

const store = new FileMemory('./data/world-one.json');
const core = createCore({ config, adapter, memory: await store.load() });
await core.tick();
await store.save(core.exportMemory());
~~~

Maintaining clear. FileMemory uses temporary file and renaming; For one file, there should be one writer. The damaged file is not wiped. worldId must coincide. The meter, History and progress of the challenges still exists; Equipment and the game world — no.

Memory Formats 1, 2 and 3 read by the new version. If a brain exists, memory is recorded in format 3, other — 2; Retro-compatibility with the old library is not guaranteed. Changing definition of objectives requires clear migration. [Details of recovery](WORKFLOWS.md).

## Game adapter

~~~js
const adapter = {
  describe() {
    return {
      protocolVersion: 1, kind: 'custom', loader: 'vanilla',
      minecraftVersion: 'tested-version', skills: ['your-skill']
    };
  },
  async observe({ signal }) {
    signal.throwIfAborted();
    return { self: { health: 20 }, inventory: {} };
  },
  async execute({ skill, args }, { signal }) {
    // Implement actual action through API for games.
    throw new Error('Skills not yet realized.');
  }
};
~~~

The regular monitor is passed on JSON, free of juices and class objects. Maximum size — 256 KiB. Adaptationr declares only the skills that have been implemented. Unsupported action is blocked with explanation. Exemption or { ok: false, message } Meaning failure.

## Extension

- registerSkill(name, handler, { validate }) — separate skills.
- use(plugin), removePlugin(id) — Skills sets.
- resetWorkflow(id) — Restart the whole task.
- retryGoal(goalId) — a clear restoration of the target (without budget challenges Planner).
- retryStep(workflowId, stepId) — repeat error or interruption.

These transactions are described in [Plagins](PLUGINS.md) and [objectives](WORKFLOWS.md). TypeScript-The announcements are part of the core package. In a branch 0.x a correct version of the relationship.

## Team coordination

Manager teams enable bounded advisory resource and ground-path leases by default. Set `cooperation: false` for independent execution, or configure `{capacity, ttlMs, maxWaitMs}`. `manager.snapshot().cooperation` contains current lease/wait diagnostics. Standalone clients can use `createSwarmCoordinator()` and `attachSwarmAgent()`; see [Team Coordination V2](SWARM-V2.md) for complete options, cleanup and execution boundaries.
