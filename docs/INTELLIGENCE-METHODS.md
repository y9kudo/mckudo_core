# New methods of intelligence OvermindMC

Author: **y9kudo**. Status 13 October 2026: First mechanism included in 0.7.0; The remaining are described as drafts of the next modules. They cannot be considered as already available.

We want, I want a little program to set the plan, And the core chose to act on its own, explained mistakes and changed the way in which it was achieved. The item received, The built block and the damage sustained is supported by a server.

## 1. Evidence Memory: failure with verified conditions

**Implemented:** `createActionEvidenceMemory`, codes `OMActionError`, Integration with the survival and common memory of the agent manager.

Normal Record «It didn't work out, repeat in two seconds» loses cause. The new entry contains error and observation code, the perpetrator. For example:

```json
{
  "code": "START_UNSUPPORTED",
  "evidence": {
    "complete": true,
    "facts": {
      "position": "0,64,0",
      "navigationMode": "ground",
      "block:0,64,0": "leg condition of block",
      "block:0,65,0": "Head condition of block",
      "block:0,63,0": "Support leg condition"
    }
  }
}
```

The block values in this entry form `blockEvidenceValue`: ID/Status name, Type of conflict and form. The example above explains the structure; These lines should not be sent to the performer as a true certificate.

Before next action, memory rereads **Only facts involved**. If they match, A meaningless start is excluded. If the support has changed, The agent moved or another mode of movement switched on, allowed new attempt. The change in the remote block does not drop the output. Unknown cup is not considered evidence of an obstacle.

Agent Blake may use a failure Avery, If you see the same starting geometry in the same world and dimension. The route may have a different purpose: Unconfirmed launch pole prevents any ground route from this cell.

This general conditional prohibition now applies only to **Tested ground planner start-up condition**. `NO_PATH`, `STEP_STALLED`, `OCCUPIED` and server correction is granted temporary delay for a particular agent. Lack of a path depends on the materials available, Production regulations, and the search budget; one error text is not sufficient for a constant general conclusion.

The survival reactor with this memory controls the delays itself (`managesRetries: true`), So the kernel does not impose a second independent timer after the support leg has been corrected. For its reactor, this flag should only be included when implementing its own failure and re-entry restrictions; default core protection.

This is an explanation for the failure of the current navigation model, Not proof of that, I'm sure that man can't physically stand on the stove. Support for partial supports needs to be expanded in the traffic model itself.

### How to Use

B `createMinecraftBrain()` memory is created automatically. `createAgentManager()` uses one common memory for a controlled group; ♪ I don't need to write the coordination on the game chat ♪.

For separate memory management:

```js
import { createActionEvidenceMemory, createAgentManager } from 'overmindmc';

const actionEvidence = createActionEvidenceMemory({
  worldId: 'my-server-world-1',
  maxEntries: 256
});
const manager = createAgentManager({
  count: 3,
  names: ['Avery', 'Blake', 'Rowan'],
  worldId: 'my-server-world-1',
  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline' },
  brainOptions: { actionEvidence }
});

console.log(actionEvidence.snapshot());
// Connection and launch remain clear command manager.execute(...).
await manager.close();
```

This one API Available from source and archive 0.7.0; old `dev.0` it's not. `worldId` should change when replacing the world. Memory limited by number of entries, stored in process and not re-established from disk. `snapshot()` Returns a copy of the records, Number of attempts prevented, general findings and re-checking.

Check without Minecraft:

```powershell
npm.cmd run demo:evidence
```

A real planner gets a synthetic world with unsupported start-up support. From 20 One attempt to create a record, Others 19 excluded from re-checked facts. After replacement of the support leg, the route is successfully constructed. It's a test of the mechanism, Not a 20-time statement of the game's speed.

## 2. OMVectorize: Sustainable landing area

**Draft:** Select the area of permissible traffic output instead of one ideal point.

Today the calculation can be geometrically accurate, but a slight error of position or delay changes the result. It is proposed to estimate the trajectory family: Current speed ± error, several possible delays and extreme positions of the body. Plan allowed, if sufficient trace coverage ends on the observed safe surface with reserve to the edge.

In the first phase — Short drops and jumps. Then — Landing of the elite and pearls. Each assessment retains a margin of error, used cups and cause of deviation. Unknown geometry reduces confidence, Not turning into air.

Verification: Same routes with delay and error of initial speed; Comparison of safe landing and loss of health with single calculation. Probability of success cannot be published until calibration on server results.

## 3. Team Production: Results agreements

**Draft:** The agent reserves the production result to be checked: «Three bars to the meeting point», Not just the nearest ore.

Target total divided by dependency: Wood → instruments → Boiler → iron → diamonds → Armoured. The purpose takes into account the tool, Health, path, accessible workstation and meeting cost. One agent can swim, While the others are being mined; The reserve is specific to the consumer and has a period of time.

Transfer shall be completed only after agreed changes in the inventory of the parties. In the event of death or unenclosed route, the obligation is cancelled, The balance is recorded for observations and the task is re-appointed. Usefulness should consider the benefit of a common goal, I want the nearest chest not to be delivered to the entire first agent.

This is an expansion of existing applications and exchanges OvermindMC. Criterion: on the same worlds, the group achieves a goal faster than independent agents, Without duplication of items and confirmed transfers.

## 4. Rehearsal: Short rehearsal

**Draft:** Check several short sequences in a local copy of the world observed before a dangerous action.

Candidates may include movement, Positioning of support, change of instrument and departure. Cost of material is compared, Test results, Health and uncertainty. Horizontal and number of options severely restricted, I want the skating and the defense to continue working on time.

The core already has physical pre-indicators and virtual changes in the blocks at the time of the core A*. The new module should combine them with the consequences of different skills, and then compare the forecast to the server observation. In large dispersions, the model reduces confidence and chooses a more conservative action.

Verification: dangerous edge set, obstacles and variable passageways; measure forecast errors and share of safe endings. Rehearsal cannot confirm the condition of unladen chocolate.

## 5. Diagnostic Probe: Action for Knowledge

**Draft:** with mixed refusal to choose cheap safety checks, which identifies possible causes.

For example, A lack of confirmation of selection may mean an obsolete item, busy slot, non-feasible approach or removal of substance. Instead of re-full route, the agent checks slots and the essence, Pending up-to-date update, then verify another confirmed approach.

Each audit has a time and risk budget. Destruction of protected buildings, Arbitrary code execution and unknown site are not used as diagnostic experiments. The result updates the observation hypothesis, which confirmed or denied it.

Verification: Play different reasons for the same external error; measure the number of useless repetitions and the time before a correct change of strategy.

## What's new

We propose concrete development of architecture OvermindMC. It's not proof of the world's uniqueness. The Library of Skills and Improved Reaction Programmes are already described by authors [Voyager](https://voyager.minedojo.org/). Training in peace models — direction [DreamerV3](https://github.com/danijar/dreamerv3). Segmented planning and recording/Cluster mining is described in [Baritone](https://github.com/cabaletta/baritone/blob/master/FEATURES.md).

The contribution should be checked against individual comparisons with the disabled module: Whether results change in the same world, Equipment, and the computer budget. Baseline hypotheses, failed launches and the cost of calculations are included in the report together with successful results.
