# Neural policies, physical environments and live actions

OvermindMC **Version Arthas** provides CPU implementations of Double DQN, categorical PPO and **discrete-action SAC**. They learn network weights from transitions; they are not aliases for the symbolic resource planner. Training is opt-in and does not begin when a library is imported.

## Choose an algorithm

| Algorithm | Data | Implementation |
| --- | --- | --- |
| Double DQN | Replay buffer; off-policy | Independent target network, Double-Q action selection, Adam, Huber loss |
| PPO | Fresh on-policy rollouts | Clipped policy ratios, generalized advantage estimation, shared value head, entropy bonus, Adam |
| Discrete SAC | Replay buffer; off-policy | Categorical actor, two independently initialized critics, entropy-regularized targets, Polyak target updates |

PPO rejects transitions from an older policy revision after optimization. Use the sample returned by `sample()` when recording a rollout. Supply a separate `envId` for each environment so advantage traces cannot leak between agents. A terminal event, such as death, does not bootstrap. A time limit ends the trace but bootstraps the value of its final observation.

SAC uses a fixed entropy coefficient `alpha` and a discrete action space. It does not expose a Gaussian continuous-control actor or automatic entropy-temperature tuning.

See the primary algorithm descriptions: [PPO](https://arxiv.org/abs/1707.06347), [SAC](https://arxiv.org/abs/1801.01290), [discrete SAC](https://arxiv.org/abs/1910.07207).

## Run a free local training experiment

From the repository root, with Node.js 24:

```powershell
npm.cmd ci
node examples/train-physical.js --algorithm=ppo --batches=400 --count=32
node examples/train-physical.js --algorithm=sac --batches=600 --count=32
```

The example creates 32 environments distributed across at most two CPU workers. It saves a checkpoint and a report under `data/physical-ppo/` or `data/physical-sac/`. Change `--count` to choose a different number of environments, and `--out` to choose a directory. No GPU, Minecraft server, paid account or API key is required.

The training fixture is intentionally small: a flat stone floor, an empty inventory, a northward goal and a slight random spawn offset. The 32 evaluation episodes use different seeds. Success here demonstrates movement learning in this fixture, not survival intelligence or an ability to finish Minecraft.

## Physical headless mode

```js
import {
  createPhysicalEnvironment, createVectorEnvironment,
  PHYSICAL_FEATURES, PHYSICAL_ACTIONS
} from 'overmindmc/intelligence';

const environment = createPhysicalEnvironment({
  seed: 7,
  mobs: 2,
  layout: 'water',
  ticksPerStep: 2,
  maxSteps: 200
});
const start = environment.reset();
const after = environment.step(1); // north

const pool = createVectorEnvironment({
  count: 128,
  workers: 2,
  environment: { kind: 'physical', mobs: 1 }
});
try {
  const states = await pool.reset();
  const results = await pool.step(states.map(() => 0));
} finally {
  await pool.close();
}
```

Each physical tick uses the same `stepPhysics` function as OMConnect, at 50 ms per tick. Use `shield: true` for a fixture that actually includes a shield. Guarding is a simplified local combat action; a missing shield cannot block damage. The environment models voxel collision, friction, gravity, jumping, liquid contact and flow, accumulated fall damage, water landing, air supply, lava damage and bounded zombie pursuit/melee. `setBlock()` permits bounded fixture edits for water, stone, webs, slime, honey and several other test blocks. Unknown terrain stays unknown.

This environment is a local physics and mob model. It does not run a vanilla server or simulate every vanilla mob, inventory transaction, crafting recipe, chunk-generation rule, enchantment or game tick subsystem. Full survival tests still run against Minecraft.

There are **18 features** and **9 actions**, with schemas `om-physical-v1` and `om-controls-v1`. The older skill-level headless environment has 22 features and 12 macro actions. Their checkpoints are incompatible; do not resize or pad a model to hide a schema mismatch.

The action order is `idle`, `north`, `south`, `west`, `east`, `jump_north`, `sprint_north`, `attack`, `guard`. The feature order is available in `PHYSICAL_FEATURES`. Health and hunger are normalized; directions and velocities retain their declared meanings.

## Transfer a policy to OMConnect

Start your local offline Java 1.21.1 server, then run:

```powershell
node examples/rl-connect-live.js --host=127.0.0.1 --port=25565 --name=ArthasRL
```

This loads the PPO checkpoint created above and looks for a short, level, observed corridor near spawn. It does not issue teleport, item-grant or world-edit commands. If no safe corridor exists, the report records a blocked trial. The result is saved to `data/rl-connect-live/report.json`.

Use `--model=data/physical-sac/checkpoint.json` to load the SAC model. Use a new nickname when testing a clean start. Do not run another movement controller for that client at the same time.

```js
import { createOMRLBridge } from 'overmindmc/intelligence';

const bridge = createOMRLBridge({
  client,
  policy,
  goal: { x: 10.5, y: 64, z: -4.5 },
  axis: 'north',
  stepMs: 100,
  retreatHealth: 8,
  train: false
});
const result = await bridge.step({ signal });
```

The bridge uses a cardinal reference frame so a north-trained policy can operate along an east, south or west corridor. Features, masks and inputs rotate together. Only ordinary control inputs and native actions are sent to Minecraft; the bridge does not change the observed player position.

Before executing a movement action, the bridge checks loaded terrain, adjacent support, hazards and a short physics projection including braking. It requires sufficient health, refuses concurrent native actions, masks unavailable shield use and attacks only reachable hostile non-player entities. Every completed step records the actual after-observation. Input is released on cancellation and policy errors.

Set `train: true` only for an intentional live training run. PPO then samples stochastically rather than collecting deterministic evaluation behavior. The bridge is a bounded low-level executor, not the full autonomous survival controller.

## Verification

Tests check learning, numerical gradients against finite differences, action masks, checkpoint restoration and invalid-state rejection. They also cover fall damage and water landing, walls and lava, zombie pursuit, 128 independent physical environments, live safety masks and input cleanup.

The October 14 trial transferred PPO to Java 1.21.1: `ArthasRL` moved toward a four-block goal through OMConnect, reached the 0.8-block success threshold, retained 20 health and received zero server position corrections. Recorded evidence separates this result from the symbolic survival trials.
