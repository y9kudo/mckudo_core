import {createKudoConnect} from '../kudoconnect/index.js';
import {isAir,isFullBlock} from '../src/navigation.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// Integration fixture only: excavate three ordinary blocks, ascend, dismantle.
// The jump, alignment, placement and descent algorithms belong to KudoConnect.
const c=createKudoConnect({username:process.env.MC_NAME||'PillarScout',host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565)});
const report={status:'running',steps:[],actions:[]},signal=AbortSignal.timeout(180000);
const run=async(skill,args)=>{const result=await c.execute({skill,args},{signal});report.actions.push({skill,args,result});return result;};
c.on('pillarStep',s=>report.steps.push(s));
try{
  await c.connect();await delay(1000);report.initial=c.snapshot();
  const scan=await c.world.findBlocks({names:['dirt','grass_block'],position:c.state.position,radius:12,count:64,signal});
  for(const b of scan.blocks||scan){
    if(c.inventory.count('dirt')>=3)break;
    if(Math.hypot(b.position.x-c.state.position.x,b.position.z-c.state.position.z)<2)continue;
    try{await run('dig',{...b.position,block:b.name});await run('collect',{item:'dirt',origin:b.position,timeoutMs:6000});}
    catch(error){report.actions.push({skill:'fixture',error:error.message});signal.throwIfAborted();}
  }
  if(c.inventory.count('dirt')<3)throw new Error('Не удалось самостоятельно собрать три блока земли для проверки.');
  let spot;
  const p={x:Math.floor(c.state.position.x),y:Math.round(c.state.position.y),z:Math.floor(c.state.position.z)};
  for(let r=0;r<=4&&!spot;r++)for(let dx=-r;dx<=r&&!spot;dx++)for(let dz=-r;dz<=r&&!spot;dz++){
    const q={x:p.x+dx,y:p.y,z:p.z+dz};
    if(!isFullBlock(c.world.blockAt({...q,y:q.y-1}))||![0,1,2,3,4,5,6].every(dy=>isAir(c.world.blockAt({...q,y:q.y+dy}))))continue;
    try{await run('navigate',{...q,range:0,bridge:false,sprintJump:false});spot=q;}catch(error){report.actions.push({skill:'approach-fixture',error:error.message});}
  }
  if(!spot)throw new Error('Нет доступной площадки с местом для подъёма.');
  report.before=c.snapshot();await run('pillar',{count:3,block:'dirt'});report.top=c.snapshot();
  await run('descendPillar',{count:3});report.after=c.snapshot();
  if(report.top.position.y-report.before.position.y!==3 || Math.abs(report.after.position.y-report.before.position.y)>.05 || report.after.health<report.before.health || report.after.metrics.corrections!==report.before.metrics.corrections)throw new Error('Подъём/спуск, здоровье или коррекции не соответствуют ожиданию.');
  report.status='passed';
}catch(error){report.status='failed';report.reason=error.message;process.exitCode=1;}
finally{report.final=c.snapshot();report.finishedAt=new Date().toISOString();await c.close();await mkdir('data',{recursive:true});await writeFile(process.env.MC_REPORT||'data/pillar-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
