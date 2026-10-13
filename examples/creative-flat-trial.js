import {readFile,writeFile,mkdir} from 'node:fs/promises';
import nbt from 'prismarine-nbt';
import {gzipSync} from 'node:zlib';
import {createKudoConnect} from '../packages/kudoconnect/index.js';
import {parseSchematic,buildSchematic} from '../src/schematics.js';

const filename=process.env.MC_SCHEMATIC;
function sample(){
  const blocks=[];for(let y=0;y<2;y++)for(let z=0;z<2;z++)for(let x=0;x<2;x++)blocks.push({pos:nbt.list(nbt.int([x,y,z])),state:nbt.int(0)});
  return nbt.writeUncompressed(nbt.comp({size:nbt.list(nbt.int([2,2,2])),palette:nbt.list(nbt.comp([{Name:nbt.string('minecraft:stone')}])) ,blocks:nbt.list(nbt.comp(blocks))}));
}
function sampleSponge(){
  const palette=nbt.comp({'minecraft:stone':nbt.int(0)}),blocks=nbt.byteArray(Array(8).fill(0));
  return gzipSync(nbt.writeUncompressed(nbt.comp({Schematic:nbt.comp({Version:nbt.int(3),DataVersion:nbt.int(3953),Width:nbt.short(2),Height:nbt.short(2),Length:nbt.short(2),Blocks:nbt.comp({Palette:palette,Data:blocks})})})));
}
const sampleName=process.env.MC_SAMPLE_FORMAT==='schem'?'creative-flat-sample.schem':'creative-flat-sample.nbt';
const source=filename?await readFile(filename):sampleName.endsWith('.schem')?sampleSponge():sample();
if(!filename){await mkdir('data',{recursive:true});await writeFile('data/'+sampleName,source);}
const schematic=parseSchematic(source,{filename:filename||sampleName});
const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',username:process.env.MC_NAME||'KudoCreative07',auth:'offline',viewDistance:24});
try{
  await client.connect();
  if(client.state.gameMode!=='creative')throw new Error('Этот тест требует Creative.');
  const foot=client.state.position,site={x:Math.floor(foot.x)+5,z:Math.floor(foot.z)+2};
  let ground=null;for(let y=Math.floor(foot.y)+2;y>=client.world.minY;y--){const b=client.world.blockAt({x:site.x,y,z:site.z});if(b?.boundingBox==='block'){ground=y;break;}}
  const origin=process.env.MC_BUILD_XYZ?Object.fromEntries(process.env.MC_BUILD_XYZ.split(',').map((v,i)=>[['x','y','z'][i],Number(v)])):{...site,y:(ground??Math.floor(foot.y)-1)+1};
  console.log(JSON.stringify({phase:'start',mode:client.state.gameMode,position:foot,origin,schematic:{format:schematic.format,blocks:schematic.blockCount}}));
  const result=await buildSchematic(client,schematic,origin,{signal:AbortSignal.timeout(120000),maxActions:Number(process.env.MC_BUILD_LIMIT||64)}).catch(error=>{
    console.log(JSON.stringify({phase:'error',message:error.message,position:client.state.position,held:client.inventory.held()?.name,metrics:client.snapshot().metrics,nearby:schematic.cells.map(c=>({position:{x:origin.x+c.x,y:origin.y+c.y,z:origin.z+c.z},actual:client.world.blockAt({x:origin.x+c.x,y:origin.y+c.y,z:origin.z+c.z})?.name||null}))}));
    throw error;
  });
  console.log(JSON.stringify({phase:'result',...result,position:client.state.position,confirmed:schematic.cells.filter(c=>client.world.blockAt({x:origin.x+c.x,y:origin.y+c.y,z:origin.z+c.z})?.name===c.block.replace(/^minecraft:/,'')).length}));
}finally{await client.close();}
