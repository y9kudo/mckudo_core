# Version Arthas: learning, planning and operations

OvermindMC, OMConnect and OMVectorize are reusable libraries authored by **y9kudo**, licensed under **MIT**. The working version is `1.0.0-Arthas-dev.1`. Stable 1.0.0 still requires a verified autonomous run from an empty inventory to defeating the Ender Dragon.

## Start locally

Use Node.js 24. SQLite requires a Node.js build with `node:sqlite` available. In the repository folder:

```powershell
npm.cmd ci
npm.cmd run test:v1
npm.cmd run train:local
node examples/train-physical.js --algorithm=ppo --count=32 --batches=400
```

These examples use CPU workers and local files. They do not require a GPU, Minecraft account, paid LLM service or API key. The training scripts write reports and models under `data/`, which is excluded from source publication.

Import the opt-in API with:

```js
import {
  createDQN, createPPO, createSAC, createRewardAPI,
  createHeadlessEnvironment, createPhysicalEnvironment,
  createVectorEnvironment, createCurriculum,
  createHTNPlanner, createMCTSPlanner, createGoalStack
} from 'overmindmc/intelligence';
```

Importing this module does not start training, create a database or connect an agent.

## Policies and environments

Double DQN uses an off-policy replay buffer, a separate target network, Adam and a Huber loss. PPO uses fresh behavior-policy samples, clipped likelihood ratios, advantage estimation and a value head. Discrete SAC uses a categorical actor, twin critics, entropy regularization and Polyak target updates. SAC is a discrete variant, not a continuous Gaussian actor. [Policy API and examples](RL-PHYSICS-AND-CONNECT.md).

The skill-level environment exposes 22 features and 12 actions. It models wood, tools, stone, a furnace, iron smelting and diamonds as macro actions. The physical environment exposes 18 features and 9 actions. It advances the same 50 ms collision/medium physics step as OMConnect and includes a bounded zombie model. Set `shield: true` only for a fixture that includes a shield; guarding without one does not prevent damage.

The physical model is not a vanilla server. It does not simulate every mob AI, inventory transaction, recipe or world-generation rule. Evaluate policies in Minecraft after simulation tests. A checkpoint must match the environment's feature and action schemas.

`createVectorEnvironment` supports many independent environments across a small worker pool. Use `environment: { kind: 'physical' }` to select physical mode; the default is skill mode. Calls are serialized, workers have memory limits and failed workers terminate the pool rather than leaving unresolved batches.

`createOMRLBridge` executes a physical policy through OMConnect with observed after-states, legal-action masks and health/terrain checks. The live transfer example is `examples/rl-connect-live.js`. The separate `createPolicyRunner` connects encoded observations to an application's skill actions; its declared encoder/action map must match the trained policy.

## Rewards and recorded experience

```js
const rewards = createRewardAPI({
  terms: {
    progress: t => t.nextObservation[0] - t.observation[0],
    death: t => t.terminated ? -1 : 0
  },
  clip: 10
});
```

Use reward terms that match your task. A terminal flag may mean success as well as death, so the short example above is appropriate only when terminal means a failure in that task. For a general scenario, pass explicit success/death facts to your own term.

The API separates termination from a time-limit truncation. DQN/SAC bootstrap a truncated final state; terminal death does not bootstrap. PPO stops its advantage trace at either boundary but retains the value bootstrap for truncation.

`createNoveltyBonus` supplies a bounded visit-count bonus. It is not RND. `createReplayWriter` stores transitions with declared feature/action schemas; `readReplay` validates them. `trainOffline` feeds validated replay into DQN. Behavior cloning uses explicit encoded demonstrations, not arbitrary video or a raw navigation log without conversion.

## Curriculum and recovery

There are 20 skill curriculum definitions and 20 Minecraft inventory goals. `createCurriculum` promotes only after a full rolling success window, and `trainCurriculum` can require an independent validation callback. The example curriculum script uses greedy validation before promotion and saves a checkpoint regularly.

```powershell
npm.cmd run train:curriculum
npm.cmd run train:curriculum -- --resume=true
npm.cmd run test:live:curriculum
```

[Curriculum settings and results](ARTHAS-CURRICULUM.md). Passing a simulation stage does not certify the corresponding Minecraft goal. The earlier DQN run validated eight stages; its furnace evaluation reached 17/32 and did not meet the 85% gate.

Curriculum memory schema 2 hashes task semantics rather than display titles. Renaming a label or translating it no longer resets progress. Known built-in dev.1 checkpoints with unchanged tasks are accepted. For a custom schema-1 checkpoint, use `migrateCurriculumMemory` with the previous and current stage definitions; changing task parameters is rejected.

`createGoalStack` selects ready goals by priority and dependencies. Recovery requeues work for revalidation. `createRecoveryPolicy` requests a bounded respawn/rebuild sequence after death; the host application must perform the action, reacquire equipment and confirm the new state. It does not invent recovered items.

## Search and optional LLM planning

HTN decomposes named tasks into approved primitive actions and tries alternative methods when prerequisites fail. MCTS explores an application's transition model under node, horizon and time budgets. The caller owns the model; a search over a symbolic transition function is not a learned Minecraft world model.

`createLLMPlanner` accepts only validated JSON actions from an allowlist, has call/time budgets and supports a validated local fallback. `createLLMProvider` supports OpenAI, Anthropic or a local compatible endpoint. External providers require your own account and may charge for use; the default local workflows make no provider calls. Credentials remain outside observations and replay.

## World memory, cooperation and monitoring

`openWorldStore` stores observations in SQLite with server/world/version/dimension scope. Returned positions are hints requiring live revalidation. Tombstones and timestamps prevent old observations from resurrecting removed blocks. Close the store when the application shuts down.

`createTeamBlackboard` uses typed observation, offer, request, role and danger envelopes with sequence numbers and expiry. `assignRoles` chooses roles from declared skills and workload. `evaluateExchange` checks quantities, reserves and benefit for both parties. Native container/transfer actions still confirm physical item movement on the server.

`createWatchdog` monitors heartbeats and limits restart storms. A watchdog in the same blocked JavaScript thread cannot kill that thread. `createWorkerSupervisor` runs the workload in a worker and can terminate a genuinely blocked worker from its parent. Persist recoverable state outside the worker.

`createTelemetry` exports bounded traces and Prometheus counters, and accepts an optional OpenTelemetry tracer from your application. The kernel measures observation, each reactor and execution separately. The dashboard exposes phase timings and the latest 256 observed snapshots. File RL replay is separate from this in-memory dashboard history.

## Implementation status

| Requested capability | Current status |
| --- | --- |
| DQN / PPO / SAC | CPU Double DQN, categorical PPO and discrete SAC implemented and tested |
| Physical headless environments | Shared collision/medium step and bounded mobs; not a full vanilla simulator |
| 100+ environments | 128 independent physical environments tested on two workers |
| Reward API and shaping | Explicit terms, potential shaping and bounded novelty |
| LLM planner | Optional validated providers/fallback; tests use mocks, not paid calls |
| MCTS / HTN | Bounded planners using caller-provided models and methods |
| Persistent map | SQLite observations with scope and revalidation |
| Evade / combat | Known-terrain retreat, protected edits, unreachable-target rejection and ranged/cover policies |
| Curriculum | 20 stages, validation gates, checkpoints; all stages not yet mastered |
| Recovery / goal stack | Bounded policies and priorities; host executes recovery |
| Offline RL / BC / transfer | Replay training, encoded demonstrations and compatible model transfer |
| Monitoring / restart / tracing | Heartbeat, worker supervision and Prometheus/OTel interfaces |
| Multiple Minecraft versions | 30 transport codecs tested; native high-level gameplay 1.21/1.21.1 |
| 1000 real bots | Not established; simulation counts do not prove server capacity |
| Shared world / roles / negotiation | Observation envelopes, claims, roles and mutually beneficial exchange checks |
| Distributed execution / Kubernetes | No supplied production cluster deployment |
| Dashboard / replay / visual debugging | Local control, task editor, observed map, timings and bounded replay; no new full 3D renderer |
| MAML / Dreamer / learned hierarchical RL | Not implemented; weight transfer and HTN are not substitutes |
| Multi-task RL / PvP self-play | Interfaces permit experiments; verified general multi-task or self-play policies are not supplied |
| Intrinsic motivation / RND | Visit-count novelty is available; RND is not implemented |

[Measured evidence](results/overmind-migration-2026-10-14.md) · [v1 readiness](V1-READINESS.md) · [Public declarations](../src/intelligence.d.ts).
