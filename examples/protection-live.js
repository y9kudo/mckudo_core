import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createKudoConnect,planRouteAsync} from '../kudoconnect/index.js';
import {isAir,isFullBlock} from '../packages/kudoconnect/src/navigation.js';

const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_NAME||'HarperGuard',version:'1.21.1',auth:'offline'});
const report={kind:'protected-edits-and-ordinary-movement',status:'incomplete',startedAt:new Date().toISOString(),refusals:[],editsSent:0};
const write=client.write.bind(client);
client.write=(name,packet)=>{if(name==='block_place'||name==='block_dig'&&[0,2].includes(packet.status))report.editsSent++;return write(name,packet);};
try{
  await client.connect();await delay(1000);report.initial=client.snapshot();
  const start=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(client.state.position[k])])),getBlock=p=>client.world.blockAt(p);
  client.protection.add({id:'test-area',dimension:client.state.dimension,min:{x:start.x-10,y:start.y-8,z:start.z-10},max:{x:start.x+10,y:start.y+8,z:start.z+10}});
  for(const action of [{skill:'dig',args:{...start,y:start.y-1}},{skill:'place',args:{...start,block:'dirt'}},{skill:'pillar',args:{count:1}}]){
    let refused=false;
    try{await client.execute(action,{signal:AbortSignal.timeout(3000)});}catch(error){if(error.code!=='KUDO_PROTECTED')throw error;refused=true;report.refusals.push({skill:action.skill,code:error.code});}
    assert.equal(refused,true,`${action.skill} must refuse the protected edit`);
  }
  let target;
  for(const [x,z]of [[4,0],[0,4],[-4,0],[0,-4],[3,3],[-3,3]]){
    for(let y=start.y+1;y>=start.y-2;y--){
      const p={x:start.x+x,y,z:start.z+z};
      if(!isAir(getBlock(p))||!isAir(getBlock({...p,y:y+1}))||!isFullBlock(getBlock({...p,y:y-1})))continue;
      const route=await planRouteAsync({start,goal:p,getBlock,maxDistance:10,maxNodes:1500,maxDrop:1});
      if(route.status==='planned'){target=p;break;}
    }
    if(target)break;
  }
  if(!target)throw new Error('Нет короткого наблюдаемого маршрута для проверки.');
  report.target=target;
  report.movement=await client.execute({skill:'navigate',args:{...target,range:0,excavate:true,bridge:false,sprintJump:false,maxDrop:1}},{signal:AbortSignal.timeout(20000)});
  await delay(500);report.final=client.snapshot();
  assert.equal(report.editsSent,0);assert.equal(report.final.metrics.corrections,report.initial.metrics.corrections);assert.ok(report.final.health>0);
  report.status='passed';
}catch(error){report.error=error.message;report.final=client.snapshot();process.exitCode=1;}
finally{
  await client.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});
  await writeFile('data/protection-live.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,error:report.error,refusals:report.refusals,editsSent:report.editsSent,target:report.target,health:report.final?.health,corrections:report.final?.metrics.corrections,report:'data/protection-live.json'},null,2));
}
