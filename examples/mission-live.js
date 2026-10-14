import { mkdir, writeFile } from 'node:fs/promises';
import { createMinecraftAgent, planRouteAsync } from '../overmindmc.js';

// A goal-based integration test. No item grants, teleports or server commands.
const agent=createMinecraftAgent({name:process.env.MC_USER||'MasonMission',worldId:process.env.MC_WORLD||'mission-trial-world',
  connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1'},
  brainOptions:{storage:false,night:false,hunting:false,defense:{attackPlayers:false}}});
const abort=new AbortController(),stop=()=>abort.abort(new Error('Live mission stopped by user.'));
const navigationOnly=process.argv[2]==='--navigation-only';
const report={version:'0.6.0',scope:navigationOnly?'coordinate-goal':'coordinate-goal-and-resources',name:agent.name,startedAt:new Date().toISOString(),status:'incomplete',actions:[],stages:[]};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
agent.client.on('action',e=>{if(report.actions.length<1024)report.actions.push({...e,position:{...agent.client.state.position},inventory:agent.client.inventory.snapshot()});console.log(e.skill,e.outcome,e.detail);});
const progress=setInterval(()=>console.log('PROGRESS',JSON.stringify({position:agent.client.state.position,tasks:agent.snapshot().taskState,inventory:agent.snapshot().inventory})),15000);progress.unref();
try {
  if(process.argv.length>3||process.argv[2]!==undefined&&!navigationOnly)throw new Error("Starting: node examples/mission-live.js [--navigation-only]");
  await agent.connect();
  report.initial=agent.client.inventory.snapshot();
  if(Object.keys(report.initial).length)throw new Error('Use a fresh MC_USER with an empty inventory.');
  await agent.client.waitFor(()=>agent.client.recipeBook.received,{event:'recipes',timeoutMs:10000,signal:abort.signal});
  // Choose a nearby observed destination for a separate non-building navigation
  // check. Planning and executing that goal still belong to the library.
  const c=agent.client,start=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(c.state.position[k])])),targets=[];
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]])for(const dy of [0,1,-1])targets.push({x:start.x+dx*4,y:start.y+dy,z:start.z+dz*4});
  let goal;
  for(const target of targets){
    const route=await planRouteAsync({start,goal:target,getBlock:p=>c.world.blockAt(p),maxNodes:256,maxDistance:12,maxDrop:1,signal:abort.signal});
    if(route.status==='planned'&&route.steps.length){goal=target;break;}
  }
  if(!goal)throw new Error('No observed nearby destination for the navigation stage.');
  await agent.goTo(goal,{range:0,bridge:false,timeoutMs:30000,signal:abort.signal});
  const arrived=['x','y','z'].every(k=>Math.floor(c.state.position[k])===goal[k]);
  report.stages.push({stage:'coordinate-goal',goal,arrived,position:{...c.state.position},status:arrived?'passed':'incomplete'});
  if(!arrived)throw new Error('Coordinate goal not observed.');
  if(!navigationOnly){
    const result=await agent.mission([{get:'#logs',count:2},{craft:'stone_pickaxe'},{craft:'furnace'}],{timeoutMs:Number(process.env.MC_TIMEOUT_MS||240000),signal:abort.signal});
    report.stages.push({stage:'resources-and-recipes',status:'passed',inventory:result.inventory});
  }
  report.status='passed';
}catch(error){report.error=String(error.message);}
finally{
  clearInterval(progress);await agent.pause();report.final=agent.snapshot();await agent.close();
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});
  const path=`data/mission-live-${report.startedAt.replace(/[:.]/g,'-')}.json`;
  await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scope:report.scope,error:report.error,stages:report.stages,path,health:report.final.state.health,metrics:report.final.state.metrics},null,2));
  if(report.status!=='passed')process.exitCode=1;
}
