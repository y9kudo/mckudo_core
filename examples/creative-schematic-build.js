import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createKudoConnect} from '../packages/kudoconnect/index.js';
import {parseSchematic,findSchematicSite,buildSchematicPhysical} from '../src/schematics.js';

const filename=process.argv[2]||process.env.MC_SCHEMATIC;
if(!filename)throw new Error('Запуск: node examples/creative-schematic-build.js <путь к .schem>');
const source=await readFile(filename),sha256=createHash('sha256').update(source).digest('hex');
const schematic=parseSchematic(source,{filename});
const part=process.env.MC_BUILD_PART||'';
if(part&&!['west','east'].includes(part))throw new Error('MC_BUILD_PART должен быть west или east.');
const baseCheckpoint='data/creative-schematic-run.json',checkpoint=part?`data/creative-schematic-run-${part}.json`:baseCheckpoint;
const middle=Math.ceil(schematic.size.x/2),cellFilter=part==='west'?cell=>cell.x<middle:part==='east'?cell=>cell.x>=middle:()=>true;
const assigned=schematic.cells.filter(cellFilter).length;
const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',username:process.env.MC_NAME||'KudoBuilder07',viewDistance:24});
let stopped=false;
process.once('SIGINT',()=>{stopped=true;console.log('Остановка после текущего действия.');});
try{
  await client.connect();
  if(client.state.gameMode!=='creative')throw new Error('Сервер должен быть в Creative.');
  await new Promise(resolve=>setTimeout(resolve,5000));
  let saved;try{saved=JSON.parse(await readFile(checkpoint,'utf8'));}catch{}
  if(part&&saved?.sha256!==sha256)try{saved=JSON.parse(await readFile(baseCheckpoint,'utf8'));}catch{}
  if(part&&!(saved?.sha256===sha256&&saved?.server===`${client.options.host}:${client.options.port}`))throw new Error('Для совместной стройки сначала запусти основного агента, чтобы он сохранил выбранную площадку.');
  let origin,site;
  if(saved?.sha256===sha256&&saved?.server===`${client.options.host}:${client.options.port}`){({origin,site}=saved);}
  else{
    const found=findSchematicSite(client,schematic);
    if(!found)throw new Error('Не найдена полностью свободная ровная площадка в загруженных чанках.');
    ({origin,site}=found);
  }
  await mkdir('data',{recursive:true});
  const persist=async extra=>writeFile(checkpoint,JSON.stringify({sha256,server:`${client.options.host}:${client.options.port}`,filename,format:schematic.format,site,origin,blockCount:assigned,part,...extra},null,2));
  await persist({status:'running'});
  console.log(JSON.stringify({phase:'site',site,origin,size:schematic.size,blocks:assigned,part,states:schematic.unsupportedStates}));
  let total=0,consecutiveStalls=0;
  while(!stopped){
    const result=await buildSchematicPhysical(client,schematic,origin,{signal:AbortSignal.timeout(180000),maxActions:64,cellFilter,strategy:part==='east'?'nearest':'layer',onProgress:p=>console.log(JSON.stringify({phase:'building',done:assigned-p.remaining,of:assigned,layer:p.layer,position:p.position,part}))});
    total+=result.actions;
    await persist({status:result.status,actions:total,remaining:result.remaining,failures:result.failures.slice(0,20)});
    console.log(JSON.stringify({phase:'batch',status:result.status,actions:total,remaining:result.remaining,failures:result.failures.slice(0,5)}));
    if(result.status==='completed'||result.status==='blocked')break;
    if(result.actions===0&&++consecutiveStalls>=2)break;
    if(result.actions)consecutiveStalls=0;
  }
}finally{await client.close();}
