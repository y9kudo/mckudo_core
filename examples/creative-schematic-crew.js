import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createKudoConnect} from '../packages/kudoconnect/index.js';
import {parseSchematic,findSchematicSite,buildSchematicPhysical} from '../src/schematics.js';

const filename=process.argv[2]||process.env.MC_SCHEMATIC;
if(!filename)throw new Error('Запуск: node examples/creative-schematic-crew.js <путь к .schem>');
const source=await readFile(filename),sha256=createHash('sha256').update(source).digest('hex');
const schematic=parseSchematic(source,{filename});
const server=`${process.env.MC_HOST||'127.0.0.1'}:${Number(process.env.MC_PORT||25565)}`;
const names=['KudoMason01','KudoMason02','KudoMason03','KudoMason04','KudoMason05'];
const clients=names.map(username=>createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',username,viewDistance:24}));
const checkpoint='data/creative-schematic-video5-site.json';
let stopped=false;
process.once('SIGINT',()=>{stopped=true;console.log('Команда остановится после текущих действий.');});

function zones(){
  const counts=Array.from({length:schematic.size.x},()=>0);
  for(const cell of schematic.cells)counts[cell.x]++;
  const total=schematic.cells.length,bounds=[0];let cumulative=0;
  for(let worker=1;worker<5;worker++){
    const limit=Math.min(schematic.size.x-(5-worker),Math.max(bounds.at(-1)+1,Math.floor(worker*schematic.size.x/5)));
    let x=limit;
    while(x<schematic.size.x-(5-worker)&&cumulative+counts.slice(bounds.at(-1),x).reduce((a,b)=>a+b,0)<total*worker/5)x++;
    cumulative+=counts.slice(bounds.at(-1),x).reduce((a,b)=>a+b,0);
    bounds.push(x);
  }
  bounds.push(schematic.size.x);
  return names.map((name,i)=>({name,from:bounds[i],to:bounds[i+1],assigned:schematic.cells.filter(c=>c.x>=bounds[i]&&c.x<bounds[i+1]).length}));
}

try{
  await clients[0].connect();
  if(clients[0].state.gameMode!=='creative')throw new Error('Командная стройка требует Creative.');
  await delay(4000);
  let saved;try{saved=JSON.parse(await readFile(checkpoint,'utf8'));}catch{}
  if(process.env.MC_CREW_NEW==='1'||saved?.sha256!==sha256||saved?.server!==server){
    const found=findSchematicSite(clients[0],schematic,{minDistance:96,maxDistance:256});
    if(!found)throw new Error('Новая ровная и пустая площадка для пяти агентов не найдена в прогруженных чанках.');
    saved={sha256,server,filename,site:found.site,origin:found.origin,size:schematic.size,blockCount:schematic.blockCount};
    await mkdir('data',{recursive:true});
    await writeFile(checkpoint,JSON.stringify(saved,null,2));
  }
  const work=zones();
  console.log(JSON.stringify({phase:'team-site',site:saved.site,origin:saved.origin,size:schematic.size,blocks:schematic.blockCount,workers:work}));
  for(let i=1;i<clients.length;i++){
    await clients[i].connect();
    if(clients[i].state.gameMode!=='creative')throw new Error(`${names[i]} не получил Creative.`);
    await delay(250);
  }
  for(const client of clients){
    const until=Date.now()+12000;
    while(Date.now()<until&&(!client.world.blockAt({...saved.site,y:saved.site.y-1})||!client.world.blockAt({x:saved.site.x+schematic.size.x-1,y:saved.site.y-1,z:saved.site.z+schematic.size.z-1})))await delay(250);
    if(!client.world.blockAt({...saved.site,y:saved.site.y-1}))throw new Error(`${client.options.username}: чанки строительной площадки не загрузились.`);
  }
  const results=await Promise.all(work.map(async(zone,i)=>{
    const client=clients[i],filter=c=>c.x>=zone.from&&c.x<zone.to;
    let totalActions=0,idle=0,last;const failureCounts=new Map();
    while(!stopped&&idle<2){
      const result=await buildSchematicPhysical(client,schematic,saved.origin,{signal:AbortSignal.timeout(180000),maxActions:64,cellFilter:filter,strategy:'nearest',failureCounts,onProgress:p=>console.log(JSON.stringify({phase:'building',agent:zone.name,done:zone.assigned-p.remaining,of:zone.assigned,position:p.position}))});
      totalActions+=result.actions;last=result;
      await writeFile(`data/creative-schematic-video5-${i+1}.json`,JSON.stringify({agent:zone.name,site:saved.site,assigned:zone.assigned,status:result.status,remaining:result.remaining,actions:totalActions,failures:result.failures.slice(0,20)},null,2));
      console.log(JSON.stringify({phase:'worker',agent:zone.name,status:result.status,remaining:result.remaining,actions:totalActions,failures:result.failures.slice(0,3)}));
      if(result.status==='completed')break;
      if(result.status==='blocked'||result.actions===0){idle++;await delay(2000);}else idle=0;
    }
    return {agent:zone.name,status:last?.status||'stopped',remaining:last?.remaining??zone.assigned,actions:totalActions};
  }));
  console.log(JSON.stringify({phase:'team-result',site:saved.site,completed:results.every(r=>r.status==='completed'),workers:results}));
}finally{await Promise.allSettled(clients.map(client=>client.close()));}
