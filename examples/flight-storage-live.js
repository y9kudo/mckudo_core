import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createKudoConnect,KUDOCONNECT} from '../kudoconnect/index.js';
import {findLabelledStorage,sortStorage} from '../mckudo_core.js';

const mode=process.argv[2]||'survey';
if(!['survey','flight','storage'].includes(mode))throw new Error('Режим: survey, flight или storage.');
const client=createKudoConnect({host:process.env.MCKUDO_HOST||'127.0.0.1',port:Number(process.env.MCKUDO_PORT||25565),username:process.env.MCKUDO_NAME||'Avery07',version:'1.21.1',auth:'offline',viewDistance:10});
const report={version:KUDOCONNECT.version,minecraft:'1.21.1',mode,startedAt:new Date().toISOString(),status:'running',events:[]};
let observer,timer;
const event=(kind,value)=>{const entry={kind,...value};report.events.push(entry);console.log(JSON.stringify(entry));};
const position=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
function landingCandidates(c,start){
  const points=[];
  for(let dx=-112;dx<=112;dx+=4)for(let dz=-112;dz<=112;dz+=4){
    const d=Math.hypot(dx,dz);if(d<55||d>112)continue;
    const x=Math.floor(start.x)+dx,z=Math.floor(start.z)+dz;
    for(let y=Math.floor(start.y)+12;y>=Math.floor(start.y)-24;y--){
      const b=c.world.blockAt({x,y:y-1,z});if(!b||!b.shapes?.some(s=>s[4]===1)||c.world.blockAt({x,y,z})?.name!=='air')continue;
      const target={x,y,z},plan=c.vectorize.planFlight({start,goal:target,cruiseHeight:16});
      if(plan.status==='planned'){points.push({target,d});break;}
    }
  }
  return points.sort((a,b)=>Math.abs(a.d-90)-Math.abs(b.d-90));
}
try{
  await client.connect();
  if(client.snapshot().identity.version!==report.version)throw new Error('Версия клиента не совпадает с версией испытания.');
  await delay(2000);report.start=client.snapshot();
  client.on('warning',e=>event('warning',{message:e.message}));
  client.on('action',a=>event('action',a));
  if(mode==='survey'){
    event('signs',{signs:client.findSigns().filter(s=>s.front.some(Boolean))});
    const storages=await client.findStorages({radius:128,count:24});event('storages',storages);
    const candidates=landingCandidates(client,client.state.position);event('landings',{count:candidates.length,nearest:candidates.slice(0,5)});
  }
  if(mode==='flight'){
    const source=findLabelledStorage(client,'Elytra'),before=await client.execute({skill:'inspectStorage',args:source});
    report.fixture={position:source,contents:before.contents.map(i=>({item:i.item,count:i.count}))};
    const amounts={};if(!client.inventory.ownedCount('elytra'))amounts.elytra=1;if(client.inventory.count('firework_rocket')<8)amounts.firework_rocket=8-client.inventory.count('firework_rocket');
    if(Object.keys(amounts).length)event('equipment',await client.execute({skill:'takeStorage',args:{...source,amounts}}));
    const candidates=landingCandidates(client,client.state.position);if(!candidates.length)throw new Error('Не найдена наблюдаемая площадка для прямого полёта.');
    report.target=candidates[0].target;event('flight-target',{start:client.state.position,target:report.target});
    observer=createKudoConnect({username:'Scout07',viewDistance:10});await observer.connect();await delay(1000);
    report.observer={samples:[],serverFlightFlag:false};
    timer=setInterval(()=>{const e=[...observer.entities.values()].find(e=>e.username===client.options.username);if(e){report.observer.serverFlightFlag||=Boolean(e.metadata.shared_flags&128);report.observer.samples.push({...e.position,flags:e.metadata.shared_flags});}},100);
    const status=setInterval(()=>console.log(JSON.stringify({kind:'flight-progress',position:client.state.position,phase:client.state.flightPhase,gliding:client.state.gliding,boost:client.state.rocketBoost})),2000);
    try{report.flight=await client.execute({skill:'fly',args:{position:report.target,maxRockets:2,timeoutMs:60000}});}
    finally{clearInterval(status);clearInterval(timer);}
    const samples=report.observer.samples;report.observer.samplesCount=samples.length;
    if(samples.length){report.observer.maxY=Math.max(...samples.map(p=>p.y));report.observer.displacement=Math.hypot(samples.at(-1).x-samples[0].x,samples.at(-1).z-samples[0].z);}
    if(!report.observer.serverFlightFlag||samples.length<10)throw new Error('Независимый клиент не подтвердил полёт сервера.');
    event('flight-result',report.flight);
    const after=await client.execute({skill:'inspectStorage',args:source});report.fixtureAfter=after.contents.map(i=>({item:i.item,count:i.count}));
  }
  if(mode==='storage')report.storage=await sortStorage(client,{sourceLabel:'Random',resumeInventory:true,preserveItems:['firework_rocket'],signal:AbortSignal.timeout(240000),onProgress:r=>event('storage-progress',r)});
  report.status='passed';
}catch(error){report.status='failed';report.error=error.message;console.error(error.stack);process.exitCode=1;}
finally{
  clearInterval(timer);report.end=client.snapshot();await observer?.close();await client.close();report.finishedAt=new Date().toISOString();
  await mkdir('data',{recursive:true});const path=`data/flight-storage-${mode}-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:path}));
}
