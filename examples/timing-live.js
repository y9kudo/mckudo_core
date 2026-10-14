import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createOMConnect,planRouteAsync} from '../omconnect/index.js';
import {isAir,isFullBlock} from '../packages/omconnect/src/navigation.js';

// One client; ordinary movement over observed blocks, no admin commands or resources.
const client=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_NAME||'MilesClock',version:'1.21.1',auth:'offline'});
const report={startedAt:new Date().toISOString(),status:'incomplete',kind:'local-cadence-and-movement'};
try{
  await client.connect();await delay(1500);report.initial=client.snapshot();
  const start=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(client.state.position[k])])),getBlock=p=>client.world.blockAt(p);
  let target;
  for(const [x,z]of [[6,0],[0,6],[-6,0],[0,-6],[4,4],[-4,4],[4,-4],[-4,-4]]){
    for(let y=start.y+2;y>=start.y-3;y--){
      const p={x:start.x+x,y,z:start.z+z};
      if(!isAir(getBlock(p))||!isAir(getBlock({...p,y:y+1}))||!isFullBlock(getBlock({...p,y:y-1})))continue;
      const route=await planRouteAsync({start,goal:p,getBlock,maxDistance:12,maxNodes:1000,maxDrop:2});
      if(route.status==='planned'){target=p;break;}
    }
    if(target)break;
  }
  if(!target)throw new Error("No short-checked route at spav.");
  report.target=target;
  report.movement=await client.execute({skill:'navigate',args:{...target,range:0,bridge:false,sprintJump:false}},{signal:AbortSignal.timeout(15000)});
  await delay(3000);report.final=client.snapshot();
  const hz=report.final.metrics.timing.effectiveHz;
  report.status=client.state.health>0&&hz>=18&&hz<=22&&report.final.metrics.corrections===report.initial.metrics.corrections?'passed':'incomplete';
}catch(error){report.error=error.message;report.final=client.snapshot();}
finally{
  await client.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});
  await writeFile('data/timing-live.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,error:report.error,initial:report.initial?.metrics.timing,final:report.final?.metrics.timing,corrections:report.final?.metrics.corrections,health:report.final?.health,target:report.target,report:'data/timing-live.json'},null,2));
  if(report.status!=='passed')process.exitCode=1;
}
