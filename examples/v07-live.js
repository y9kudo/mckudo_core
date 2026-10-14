import { createOMConnect, OMCONNECT, planRoute, volumeClearance, traceVolume } from '../omconnect/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Native, nonadministrative integration check. It never grants equipment or edits terrain.
const client=createOMConnect({host:process.env.MC_HOST??'127.0.0.1',port:Number(process.env.MC_PORT??25565),username:process.env.MC_NAME??'RowanVector07',version:'1.21.1'});
const report={version:OMCONNECT.version,startedAt:new Date().toISOString(),status:'running',checks:[],warnings:[],fullDragonRun:false};
const signal=AbortSignal.timeout(90000),check=(name,detail)=>{report.checks.push({name,status:'passed',detail});console.log(name+': passed');};
client.on('warning',e=>report.warnings.push(String(e.message).slice(0,200)));
try{
  await client.connect();check('native-offline-login',{dimension:client.state.dimension,health:client.state.health});
  await client.waitFor(()=>client.recipeBook.received,{signal,event:'recipes',timeoutMs:10000});check('world-recipes',client.recipeBook.snapshot());
  await delay(1000,undefined,{signal});
  const p=client.state.position,start={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)},candidates=[];
  for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)for(let dy=-1;dy<=1;dy++){
    if(Math.hypot(dx,dz)<2||Math.hypot(dx,dz)>4)continue;
    const goal={x:start.x+dx,y:start.y+dy,z:start.z+dz};
    const route=planRoute({start,goal,getBlock:q=>client.world.blockAt(q),maxNodes:300,maxDistance:8,maxDrop:1,bridgeBudget:0});
    if(route.status==='planned')candidates.push({goal,cost:route.cost});
  }
  candidates.sort((a,b)=>a.cost-b.cost);
  if(candidates[0]){
    const before=client.metrics.corrections,result=await client.execute({skill:'navigate',args:{...candidates[0].goal,range:0,bridge:false,excavate:false}},{signal});
    check('native-ground-navigation',{result,corrections:client.metrics.corrections-before});
  }else report.checks.push({name:'native-ground-navigation',status:'not-tested',reason:"There is no safe observed route near the bead."});
  const found=await client.world.findBlocks({names:['water'],position:client.state.position,radius:24,count:32,signal});
  let vectorPlan=null;
  for(const water of found.blocks){
    const at={x:water.position.x+.5,y:water.position.y+.05,z:water.position.z+.5};
    if(!volumeClearance({position:at,getBlock:q=>client.world.blockAt(q)}).clear)continue;
    for(const delta of [{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}]){
      const goal={x:at.x+delta.x,y:at.y+delta.y,z:at.z+delta.z};
      if(!traceVolume({from:at,to:goal,getBlock:q=>client.world.blockAt(q)}).clear)continue;
      const result=await client.vectorize.planAsync({start:at,goal,maxNodes:300,maxDistance:4,signal});
      if(result.status==='planned'){vectorPlan={start:at,goal,result};break;}
    }if(vectorPlan)break;
  }
  if(vectorPlan)check('vectorize-on-server-chunks',{...vectorPlan,movementExecuted:false});
  else report.checks.push({name:'vectorize-on-server-chunks',status:'not-tested',reason:"No suitable water volume found in the loaded cups."});
  await delay(2000,undefined,{signal});report.snapshot=client.snapshot();report.status='passed';
}catch(error){report.status='failed';report.reason=error.message;process.exitCode=1;}
finally{await client.close();report.closed=client.state.status==='disconnected';report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/v07-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
