# Perception Minecraft: format 1

`normalizeObservation` it sets the overall structure JSON for adapters. Mineflayer and the simulation announce `perceptionVersion: 1` in `describe()`. The core checks their observations. Old adapters keep returning theirs without this ad JSON; Automatic compatibility with the new scheme is not intended.

```json
{
  "perceptionVersion": 1,
  "dimension": "minecraft:overworld",
  "self": { "health": 20, "food": 18, "position": { "x": 0, "y": 64, "z": 0 } },
  "inventory": { "minecraft:oak_log": 0, "minecraft:oak_planks": 4 },
  "world": { "dimension": "minecraft:overworld", "nearbyBlocks": { "minecraft:oak_log": true } },
  "entities": [],
  "time": { "timeOfDay": 1000, "isDay": true }
}
```

| Section | Semantics |
|---|---|
| `self` | Health, Hunger and coordinates. Unknown — `null` |
| `inventory` | Number of items by category `namespace:id`, Totals >= 0 |
| `world.dimension` | Measuring identifier or `null` |
| `entities` | Before 128 of observed entities: Line `id`, `name`, coordinates `position`; `null`, If not observed |
| `time.timeOfDay` | 0–23999 or `null` |
| `time.isDay` | `true`, `false` or `null` |

`dimension` Intended for compatibility. It matches the `world.dimension`. Additional adapter fields allowed. For example, `world.nearbyBlocks` Report on the types of blocks found, but does not guarantee the achievable path to them.

Missing inventory key means unknown item, a//////////. Mineflayer Fills zero quantities of items known to the register; The simulator only knows its small set. Unknown values cannot be replaced by fictional zeros or safe state: The transportability of the regulations depends on the, What facts really provide the adapter.

Mineflayer 0.4 tracks classes `#logs`, `#ores`, `#workstations`, `#crops` within a radius 128 blocks. `searchRadius` and `entityRadius` Set to 512; `requestedViewDistance` Requests 16 chunks (2–32), Actual upload is delivered by the server. `trackedBlocks` Accepts before 128 ID/classes. The near-term objects are selected, to 128. The block caches, a `observeThreats` provides a separate quick picture for protection. All Options: [AUTOMATION.md](AUTOMATION.md).

`world.sampledBlocks` contains up to 512 Finds with coordinates, `world.crops` — cultural history with sign of maturity. In a bag sample `nearbyBlocks[id] === null` means, I'm sure the type is unconfirmed; It's not a claim of absence in the whole radius. `world.blocks` — requested `watchedPositions` with keys `x,y,z`, for construction. `combat.attackers` contains confirmed sources of recent damage.

Observation should be routine JSON No game classes, client references and cycles, No more 256 KiB. The simulator does not simulate the behavior of the mobs, full physics or natural playtime. The convergence of the data scheme does not mean the same completeness of the world model.

[JSON Schema normalized observation](../schemas/perception.schema.json) Available for external adapters. The conformity of the two measurement fields shall be further checked normalizeObservation.
