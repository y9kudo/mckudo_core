# Learning, planning and team

OvermindMC contains two small local neuronets. They don't need API-Keys and a paid server. They start with the initial weights and learn from the results of the game; It's not a pre-trained language model or proof of universal intelligence.

## What he's krafting and why

The application sets the target, e.g. wooden pick. The kernel requests appropriate prescriptions from the current server, Unlocks the dependence to accessible materials and checks the equipment before each step. For a curly, a chain may include logs, boards, Sticks and sticks. If the birch is more accessible than the oak, Wood class allows use of wood.

Planner `24 → 24 → 1` Assesses the probability of failure of health action, Reserves, instruments, Distances, measurement and features of the subject/prescription. Reverse error and buffer before 256 The sequences are updated after action. After the first eight examples, the evaluation adds limited value to the selection. A failed source can give way to another. Cancellation for protection is not recorded as a learning error. Damage after successful action is considered a bad outcome.

The prescriptions and physical limitations are checked by the normal code. The neirs are ranked by the acceptable options, Not create objects or new recipes. Having updated weights does not in itself mean improving results: It's tested by separate tests.

```js
import {createOMConnect} from '../omconnect/index.js';
import {createMinecraftBrain} from '../overmindmc.js';

const client = createOMConnect({
  host: '127.0.0.1', port: 25566, version: '1.21.1', username: 'Alice'
});
await client.connect();
const brain = createMinecraftBrain({
  client,
  worldId: 'my-world-1', // The New World — New memory identifier.
  survival: {targets: {'minecraft:wooden_pickaxe': 1}},
  storage: false
});
brain.start();
// After observations:
console.log(brain.survival.snapshot().plan);
console.log(brain.cognition.snapshot());
// At the end of the application: await brain.stop(); await client.close();
```

Import routes in the example are designed for a file in `examples/`. Use the package for the package `mckudo` and `overmindmc/connect`.

`cognition: false` Disables the learning ranking of actions. `neural: false` Separately shuts down navigation training. `brain.cognition.export()` Returns weight and experience; Pass them to `cognition: {memory}` And then the next brain is made with the same `worldId`. Manager with `memoryDirectory` It does it automatically. The memory folder should not be published with the code.

## Research and movement

No seagoing `12 → 16 → 1` Trained in completed crossings. A* takes into account its assessment with the support, Collision, The fall and other players. The study reduces the attractiveness of newly completed areas and areas of poor experience, then check the route. Unknown blocks are not considered air.

Turn is limited in speed and smooth. Sprint and jumps are only activated at a proven site with a reserve; during dangerous encounter with another player, speed drops. It's controlled behavior, Not a promise of complete resemblance to a person.

## Combating policy Java 1.21/1.21.1

- The strikes await the recovery of the weapon selected. The change of subject takes into account the new delay.
- The axe is selected against the shield observed, Called to an agent. The second-hand shield during meal is not considered to be a lock.
- The shield is moved into the second hand once with the equipment confirmed; Weapons selection is being restored. Packet `set_cooldown` Prohibits the use of temporarily disabled shields.
- During the defense, the agent keeps looking at the enemy. In poor health, a exit is selected, for re-entry — shield or safe lateral movement. The shield is not a universal answer against the axe.
- With sufficient health and a free area, the agent can make a simple jump and try to hit a fall without a sprint. An attack package is not considered to be evidence of critical damage.
- With a stranger outside the target, the ax is preferred, To avoid a sword-bang. In the absence of a suitable safe option, the impact is delayed.

Basis of the study: Official materials Mojang o [swords and the reconstruction of the attack](https://www.minecraft.net/en-us/article/taking-inventory--sword), [Axes against shield](https://www.minecraft.net/en-us/article/taking-inventory--axe), [shielded](https://www.minecraft.net/de-de/article/taking-inventory--shield), and [API PlayerEntity 1.21.1](https://maven.fabricmc.net/docs/yarn-1.21.1%2Bbuild.3/net/minecraft/entity/player/PlayerEntity.html). Old Articles contain overview information; The weapons table and protocol checks in the code refer to the native profile 1.21/1.21.1.

This tactic is tested by automatic tests. Victory against a Strong Man, Critical impact and blackout of another's shield shall be separately demonstrated by game trials.

## Twenty agents

Need a server minimum c 21 Slot, If you're playing with 20 agents. For a separate Java-The servers are installed `max-players=32` in `server.properties` And restart it. The Nate client uses offline-profile; Local test server limit `server-ip=127.0.0.1`.

```powershell
$env:MC_PORT = '25566'
$env:MC_WORLD = 'my-new-world'
$env:MC_COUNT = '20'
$env:MC_TEST_MINUTES = '8'
$env:MC_KEEP_OPEN = '1'
npm.cmd run test:live:fleet-learning
```

Names: Alice, Blake, Charlie, Dylan, Ella, Finn, Grace, Henry, Ivy, Jack, Kai, Leo, Mia, Nora, Oliver, Parker, Quinn, Ruby, Sam, Theo. Goal — Each one has a wooden pick. Test sets a target, Disables sleep side tasks/Hunting and writing a report; All logic works in the library. Panel — `http://127.0.0.1:4180`. After completion of c `MC_KEEP_OPEN=1` agents on pause, The panel stays open. Without this variable connection, close.

Cooperative uses `OMPeer`: Cluster requests include the cost of a neural experience approach. The ownership is chosen according to the rate and the order of the names. Messages are transmitted between agents outside the game chat room. It's an integrated harmonization protocol, Not self-invented language by neurostrots.

Manager can offer exchange or gift over-supplies, by maintaining the tools and reserves. Needs take into account the current craft relationships. Transfer requires observed changes in both instruments and selection events; The message sent does not prove delivery.

`data/fleet-learning-live.json` contains the result of the entry, Action, Errors, Training, achieving the goals and the exchange log. `passed` means the achievement of objectives by all participants and the application of a minimum of two agents; ♪ ♪ ♪ ♪ I'm gonna be ♪ ♪ ♪ you can check it out ♪ ♪ `transfers`. Error `server_full` stops the test before starting the targets. Change the world `MC_WORLD`; for strictly empty primary equipment, use new names through `MC_NAMES`.
