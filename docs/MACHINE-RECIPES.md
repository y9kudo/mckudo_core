# Machine recipes · OvermindMC 0.7

`createMachineGraph` imports normalized data on mechanisms. `planMachineResources` Finds Dependence, a `executeMachinePlan` causes the Annex-Described Implementing and checks the result. Author **y9kudo**, MIT.

## Why a separate graph

Versa is so transformed into an object. A fashion machine can use objects simultaneously, Liquid, energy and non-combustion catalyst, and return several products. Replacement of such an operation `craft` loses the prescription.

```js
import {createMachineGraph,planMachineResources} from 'overmindmc';

const graph=createMachineGraph({
  schemaVersion:1,minecraftVersion:'1.21.1',source:'my-modpack-export',
  recipes:[{
    id:'example:washed_iron',machine:'example:washer',
    inputs:[
      {id:'example:iron_dust',amount:2},
      {kind:'fluid',id:'minecraft:water',amount:250}
    ],
    outputs:[{id:'example:iron_ingot'},{id:'example:slag'}],
    catalysts:[{id:'example:filter'}],
    energy:{unit:'example:fe',amount:80},durationTicks:40
  }]
});

const plan=planMachineResources({
  graph,targets:[{id:'example:iron_ingot',amount:3}],
  inventory:[
    {id:'example:iron_dust',amount:6},
    {kind:'fluid',id:'minecraft:water',amount:750},
    {id:'example:filter'}
  ]
});
console.log(plan.status,plan.missingExecutors);
```

`example:*` — Training ID, Not a specific fashion recipe statement. Full local example: [examples/machines.js](../examples/machines.js).

For a newbie, there's a ready one [machine-recipes.json](../examples/machine-recipes.json) and [JSON-Scheme](../schemas/machine-recipes.schema.json). VS Code The field will be specified when editing this file; `npm.cmd run demo:machines` it's the one that's downloading it.

## Fields

| Field | Meaning |
|---|---|
| `id` | Unique ID prescription, for example `create:pressing/iron_ingot` |
| `machine` | ID Type of perpetrator; The app links it to the real car |
| `inputs` | Expendable resources per operation |
| `outputs` | Guaranteed results per transaction; By-products here, too |
| `catalysts` | Items/Liquids, I need you to, But they don't spend |
| `energy` | Energy for operation in clearly named units; aggregated by unit |
| `durationTicks` | Duration of operation, 20 Tics = 1 Playtime at normal TPS |

In resource `kind` default `item`, for liquid — `fluid`. `amount` default 1. Liquid units select exporter in agreement with the agent, For example, millibachetes. Subject matter and liquid with the same ID other resources.

JEI He does recipe catalysts of which workstations: It's a source for the field `machine`, not necessarily for non-burnable materials `catalysts`. Energy FE, RPM and mechanical voltage Create — different values. Speed, pressure, The temperature and shape of the multi-unit machine shall be checked by the specific operator; The graph does not automatically translate them into FE.

The planner takes into account resources already available, Several exits, Whole lots, Catalysts and maintenance of all final goals. A failed prescription branch doesn't use another branch's reserve. Cycles, Search budgets, Lack of baseline resources and lack of source return `blocked` with cause. Probable result with `chance < 1` Not accepted as guaranteed. Reverse production cycles require separate modelling.

`status: 'planned'` Shows, I think the material chain is calculated. `executable: false` and `missingExecutors` Mean, That the chain should not be run by existing drivers. Energy in the plan — requirement; The nutrition is checked by the person in the area.

## JEI / Forge / NeoForge / Fabric

[JEI IRecipeManager](https://github.com/mezz/JustEnoughItems/blob/1.21.1/Common/src/api/java/mezz/jei/api/recipe/IRecipeManager.java) Provides Java API for categories, The use of prescription and ingredients within a fashion client. For transfer to Node.js You need an exporter in a fashion environment, which converts this information into a given JSON. The types of recipes may have their own additional conditions; The exporter must take them into account.

Current JavaScript-Import **is not ready JEI-Fashion**, automatic network connections Forge or by a universal exporter Create/AE/IC2. Vanilla `declare_recipes` does not replace specific fashion-specific network profiles. Existing imports JAR/datapack remains separately available JSON-Prescriptions. The new graph format allows real exporters to be added without changing user objectives.

## Performance checked

```js
import {executeMachinePlan} from 'overmindmc';

// Both functions below provide an adapter for a specific fashion machine.
const result=await executeMachinePlan({
  plan,
  executors:{'example:washer':machineAdapter.run},
  observe:()=>machineAdapter.observeResources(),
  timeoutMs:30000
});
```

For a plan to be implemented, indicate `executors: ['example:washer']` Planning. `observeResources` Returns `{ revision, resources }`: Actual audit and resources in the agreed area of the machine accounting. Area includes entrances, exits, Liquid tanks and catalysts. Between the images, the side effects of this area should be excluded; otherwise correct performance may be rejected from-for balance sheet differences.

Once operational, a new audit and exact change in inputs are required/exit; The catalyst must be retained. Returned by the driver `{ok:true}` Not enough on its own. Error Stops the following Actions, But the game operations that have already been done don't roll back. Driver has to respond `signal`: Time-Out is no longer waiting for results, But unable to stop the arbitrary code of a stranger.

Planning and contract of verification tested on machine models. The real fashion factory hasn't started yet.
