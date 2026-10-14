# Flight and warehousing to 0.7

Both skills work through OMConnect with Minecraft Java 1.21.1. The decision to group items is in OvermindMC, a Calculation of the safe air corridor — in OMVectorize. Local server uses the entrance `offline`.

## Rapid start of tests

Open the terminal VS Code root `mckudo_core`. B PowerShell Use `npm.cmd`:

```powershell
npm.cmd ci
npm.cmd run test:live:flight-storage:survey
npm.cmd run test:live:flight
npm.cmd run test:live:storage
```

server: `127.0.0.1:25565`, Java 1.21.1, offline, free seats `Avery07` and `Scout07`. Command `survey` Only examines the signs, Warehouses and possible landing sites. `flight` He's taking **one** A couple of elites and exactly eight missiles from the chest with a sign `Elytra`, automatically selects the observed site and flies to it. `Scout07` Independently watching the elitist's disclosure and movement. `storage` Finds a chest with a sign `Random`, uses empty chests nearby, Post signatures and installs objects.

If the server is different, Please, give me a drink `OVERMIND_HOST`, `OVERMIND_PORT` and `OVERMIND_NAME` surrounded. The Example Saves Detailed JSON to local `data/`; This folder is not published. Re-schedule `storage` Continues to work with inventory items `Avery07`, keeping his missiles.

## Using skills in their code

```js
import {createOMConnect} from 'overmindmc/connect'
import {findLabelledStorage, sortStorage} from 'overmindmc'

const client = createOMConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Avery07', version: '1.21.1', auth: 'offline'
})

try {
  await client.connect()
  const equipmentChest = findLabelledStorage(client, 'Elytra')
  await client.execute({
    skill: 'takeStorage',
    args: {...equipmentChest, amounts: {elytra: 1, firework_rocket: 8}}
  })

  // The coordinates of the landing point are taken from survey Or from your own planner.
  const goal = {x: 41, y: 64, z: -70}
  const route = client.vectorize.planFlight({start: client.state.position, goal})
  if (route.status !== 'planned') throw new Error(route.reason)
  const flight = await client.execute({skill: 'fly', args: {position: goal}})
  console.log(flight.landingError, flight.rocketsUsed)

  const warehouse = await sortStorage(client, {sourceLabel: 'Random'})
  console.log(warehouse.status, warehouse.conserved)
} finally {
  await client.close()
}
```

Value `goal` in this fragment — a world-specific example. For your card, you can first do it `survey`. The flight route checks the loaded blocks and the flat site 7×7; if the blocks are unknown or the landing is occupied, He doesn't start flying. The perpetrator tracks the state of the elite and missiles through server packages, and after landing checks position and health.

For accurate transfer, use can be made `client.execute({skill:'depositStorage', args:{x,y,z,amounts:{oak_log:7}}})`. `takeStorage` It works the same way in the opposite direction. `inspectStorage` Returns the contents without transfer, a `labelStorage` accepts `lines:['Materials','OvermindMC']` and confirms the server NBT. The old user inscription doesn't automatically rewrite. For re-start after cliff, specify `resumeInventory:true` and list your own agent items in `preserveItems`, for example `['firework_rocket']`.

OvermindMC Distribution of items into six categories: Construction, Materials, Equipment, food, Plants and drops, Miscellaneous. Each category needs a separate accessible chest. Of the chests already occupied, the core only chooses those, which had previously signed themselves. The carry-over is supported by a decrease in the base runoff and an increase in the target; The final passage compares the numbers and checks the absence of confusion of the categories. The plates are used as usual items.

[Results of two tests](results/flight-storage-2026-10-12.md) describe the actually monitored packages, Number of items and corrections found.
