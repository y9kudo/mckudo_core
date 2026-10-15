import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createOMConnect,planRouteAsync,OMCONNECT} from '../omconnect/index.js';
import {createNavigationGoal} from '../src/navigation-goal.js';
import {catalogFromMinecraftData} from '../src/catalog.js';
import {isAir,isFullBlock} from '../packages/omconnect/src/navigation.js';

// Bounded verification on a server you control. No commands, spawned equipment or PvP.
const c=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_NAME||'RowanBeta1',version:process.env.MC_VERSION||'1.21.1',auth:process.env.MC_AUTH||'offline'});
const report={version:OMCONNECT.version,startedAt:new Date().toISOString(),status:'incomplete',stages:[]};
const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
const runGoal=async(position,catalog)=>{
  const reactor=createNavigationGoal({client:c,position,range:0,bridge:false,catalog});
  const deadline=performance.now()+5000;let action;
  while(!action&&performance.now()<deadline){const r=reactor.react({dimension:c.state.dimension,self:c.state,inventory:c.inventory.snapshot()});if(r===null)return {alreadyAtGoal:true};action=r.action;if(!action)await delay(25);}
  if(!action)throw new Error('Core route planning did not produce an action.');
  return c.execute(action,{signal:AbortSignal.timeout(20000)});
};
try {
  await c.connect();await delay(1500);const initial=c.snapshot();
  report.stages.push({stage:'login',status:'passed',health:initial.health,dimension:initial.dimension});
  const start=floor(c.state.position),getBlock=p=>c.world.blockAt(p);let destination;
  for(const [dx,dz] of [[8,0],[0,8],[-8,0],[0,-8],[5,5],[-5,5],[5,-5],[-5,-5]]){
    for(let y=start.y+2;y>=start.y-2;y--){
      const goal={x:start.x+dx,y,z:start.z+dz};
      if(!isAir(getBlock(goal))||!isAir(getBlock({...goal,y:y+1}))||!isFullBlock(getBlock({...goal,y:y-1})))continue;
      const route=await planRouteAsync({start,goal,getBlock,maxNodes:1000,maxDistance:16,maxDrop:2});
      if(route.status==='planned'){destination=goal;break;}
    }
    if(destination)break;
  }
  if(!destination)throw new Error('No observed supported short route is available at spawn.');
  const catalog=catalogFromMinecraftData(c.registry);
  const before=performance.now();
  const outward=await runGoal(destination,catalog);
  report.stages.push({stage:'core-planned-outbound',status:'passed',elapsedMs:performance.now()-before,steps:outward.steps});
  const home=await runGoal(start,catalog);
  report.stages.push({stage:'core-planned-return',status:'passed',steps:home.steps});
  report.routePlansReused=c.metrics.routePlansReused||0;
  report.combat={status:'not-run',reason:'Use a prepared PvE/PvP arena for controlled damage and shield trials.'};
  await delay(1000);const final=c.snapshot();
  report.final={health:final.health,position:final.position,corrections:final.metrics.corrections-initial.metrics.corrections,timing:final.metrics.timing,maxTickMs:final.metrics.maxTickMs};
  report.status=report.routePlansReused>=2&&report.final.corrections===0&&final.health>=initial.health&&Math.hypot(final.position.x-start.x-.5,final.position.z-start.z-.5)<.5?'passed':'incomplete';
} catch(error){report.error=String(error.message);}
finally {
  await c.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});
  await writeFile('data/beta1-live.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
}
