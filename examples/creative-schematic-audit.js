import {readFile} from 'node:fs/promises';
import {createOMConnect} from '../packages/omconnect/index.js';
import {parseSchematic} from '../src/schematics.js';

const filename=process.argv[2]||process.env.MC_SCHEMATIC;
if(!filename)throw new Error("Starting: node examples/creative-schematic-audit.js <path to .schem>");
const schematic=parseSchematic(await readFile(filename),{filename});
const saved=JSON.parse(await readFile('data/creative-schematic-run.json','utf8'));
const client=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',username:process.env.MC_NAME||'OMAudit07',viewDistance:24});
try{
  await client.connect();
  await new Promise(resolve=>setTimeout(resolve,3000));
  const offset=schematic.offset||{x:0,y:0,z:0},missing=[];
  for(const cell of schematic.cells){
    const p={x:saved.origin.x+offset.x+cell.x,y:saved.origin.y+offset.y+cell.y,z:saved.origin.z+offset.z+cell.z};
    const actual=client.world.blockAt(p),properties=actual?.getProperties?.()||{};
    if(actual?.name===cell.block.replace(/^minecraft:/,'')&&Object.entries(cell.properties||{}).every(([k,v])=>String(properties[k])===v))continue;
    missing.push({position:p,expected:cell.block,wanted:cell.properties,actual:actual?.name,properties,surround:[[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(([x,y,z])=>client.world.blockAt({x:p.x+x,y:p.y+y,z:p.z+z})?.name)});
  }
  const summary=Object.fromEntries([...new Set(missing.map(c=>`${c.expected} => ${c.actual}`))].map(key=>[key,missing.filter(c=>`${c.expected} => ${c.actual}`===key).length]));
  console.log(JSON.stringify({remaining:missing.length,summary,missing:missing.slice(0,120)}));
}finally{await client.close();}
