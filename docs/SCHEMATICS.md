# Construction in the Creative

OvermindMC reads charts Minecraft Java, Chooses a free seat on loaded cups and builds gradually through action OMConnect: Takes an object from Creative-equipment, It's good, turns around, Puts a block and checks it against the state of peace. Commands `/fill` and `/setblock` building doesn't use. Things like `facing=east` in the component of the subject `minecraft:block_state`; This path is checked on the server Java 1.21.1 with a ladder.

## Formats

| Extension | What Reads |
| --- | --- |
| `.nbt` | Structure, saved by the structure block Java. |
| `.litematic`, `.litematica` | Regions Litematica, palettes and packaged indices. |
| `.schem` | Sponge Schematic v2/v3, Like modern WorldEdit; Palitrate, VarInt, properties and `Offset`. |
| `.schematic` | Old MCEdit/Schematica `Alpha`; Simple blocks only without numbers metadata. Non-transferable ID Reverse with a clue to convert a file to `.schem`. |

Loading limited 8 MB compressed file, 32 MIB unpacked NBT, 65 536 volume and 4096 units. Empty Cells Do Not Destroy the World. Map with block objects (e.g. contents of chests or tablets) As long as the block is carrying, Not its contents. To survive, it remains API `buildSchematic`, which checks materials and does not replace complex conditions with conventional blocks.

## Start without programming

1. Run the local server Java 1.21.1 in Creative Incoming `offline` Open the folder `mckudo_core` in VS Code.
2. Open the terminal PowerShell And you'll have to do the lower team. You must write the path to the file in quotes, If there are gaps in it:

```powershell
npm.cmd ci
node examples/creative-schematic-build.js "C:\Users\y9kudo\Downloads\31942.schem"
```

Agent `OMBuilder07` I'll have some tea, Check the support under the whole scheme and the absence of structures in its volume. He's on a plane during the construction, Fly between adjacent points of vision and land only then, When no flight is possible. The selected coordinates and progress will be made in the terminal. File `data/creative-schematic-run.json` stores a diagram identifier, server and site. Restart with the same file will continue construction at the previous location, by checking every block with the world. To stop, press `Ctrl+C`: Agent will complete the current action and pass out. Do not delete the progress file, If you want to continue the same construction.

For another port, point before launch `$env:MC_PORT='25566'`; For another nick — `$env:MC_NAME='MyBuilder'`. The scheme can also be downloaded from the local panel `http://127.0.0.1:4180/`, but full-scale construction of a large file is convenient to observe through an example above.

## Five builders for filming

```powershell
node examples/creative-schematic-crew.js "C:\Users\y9kudo\Downloads\31942.schem"
```

Command is running `OMMason01`–`OMMason05`, Find a separate empty site and divide the width of the diagram into five non-transverse workstations. Agents use flight, Take blocks to Creative-and each of them each. The magazine shows progress and mistakes of each person. New site coordinates are recorded in `data/creative-schematic-video5-site.json`, The re-launch therefore continues at the same location. I'll put a new take on another free site `$env:MC_CREW_NEW='1'` Before launch. When you start shooting, Teleport your character to the coordinates `team-site` From the magazine.

## Use as libraries

```js
import {readFile} from 'node:fs/promises';
import {parseSchematic,findSchematicSite,buildSchematicPhysical} from 'overmindmc';
import {createOMConnect} from 'overmindmc/connect';

const client=createOMConnect({host:'127.0.0.1',port:25565,version:'1.21.1',auth:'offline',username:'Builder'});
try {
  await client.connect();
  const schematic=parseSchematic(await readFile('house.schem'),{filename:'house.schem'});
  const placement=findSchematicSite(client,schematic);
  if(!placement)throw new Error("No checked free space in the cups received.");
  let result;
  do {
    result=await buildSchematicPhysical(client,schematic,placement.origin,{maxActions:64});
    console.log(result.status,result.remaining);
  } while(result.status==='partial');
} finally { await client.close(); }
```

`findSchematicSite` reads only cups received from the server and does not clean other people's buildings. For a large circuit, its blocks must be placed in the server visibility area. `buildSchematicPhysical` Returns `completed` Only after all the status of the blocks have been checked; `partial` means the limit of action for calling, `blocked` contains the causes and coordinates of the problems. When the scheme has `Offset`, `placement.origin` already includes it: Set him up, Not coordinates `site`.

The scheme may require a potted plant, multiple block or support, which the player's usual action does not provide. Such cases remain in the `failures` and are not considered completed. The result of a specific test shall be recorded separately from the general format support promises.
