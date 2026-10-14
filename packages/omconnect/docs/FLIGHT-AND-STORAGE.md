# Flight and storage operations

OMConnect Performs physical acts. Distribution of items by category is OvermindMC; independent OMConnect Any rules of your application can be passed.

```js
import {createOMConnect} from 'omconnect'

const client = createOMConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Avery07', version: '1.21.1', auth: 'offline'
})
try {
  await client.connect()
  console.log(client.findSigns({text: 'Elytra'}))
  console.log(await client.findStorages({radius: 64}))

  const chest = {x: 10, y: 64, z: 20} // replace the coordinates with your own
  console.log(await client.execute({skill: 'inspectStorage', args: chest}))
  await client.execute({skill: 'takeStorage', args: {...chest, amounts: {elytra: 1, firework_rocket: 8}}})

  const goal = {x: 90, y: 64, z: 20} // The site shall be visible and clear
  const plan = client.vectorize.planFlight({start: client.state.position, goal})
  if (plan.status === 'planned') {
    console.log(await client.execute({skill: 'fly', args: {position: goal}}))
  }

  await client.execute({skill: 'depositStorage', args: {...chest, amounts: {oak_log: 4}}})
  await client.execute({skill: 'labelStorage', args: {...chest, lines: ["Tree", 'OvermindMC']}})
} finally {
  await client.close()
}
```

`takeStorage` and `depositStorage` Accept `items` (All matching steps), `amounts` (exact quantities) or `all:true`. They are waiting for the change in the original and targeted equipment, without declaring success until the server answers. `labelStorage` uses an existing empty panel or puts a new one next to or from above; No one's writing anything else. Flight Planner checks direct air corridor and site 7×7, And the performer checks the elitist's disclosure, Missile and landing. The complete observation models and tests are in the package.
