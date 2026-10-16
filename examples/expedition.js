import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createOMConnect} from '../omconnect/index.js';
import {OVERMIND,createEndExpedition,fullExpeditionScenario} from '../overmindmc.js';
const scenario=fullExpeditionScenario();
if(process.argv.includes('--check'))console.log(JSON.stringify({name:scenario.name,stages:scenario.steps.map(s=>s.id)},null,2));
else{
  const player=process.env.MC_NAME||'ArthasAgent',worldId=process.env.MC_WORLD_ID||'my-survival-world';
  const file=process.env.MC_REPORT||'data/expedition/report.json',stop=new AbortController();
  const client=createOMConnect({username:player,host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:process.env.MC_VERSION||'1.21.1',auth:'offline'});
  let expedition,activeAction=null,totalActions=0,lastSave=0;const actions=[];
  const report={version:OVERMIND.version,player,worldId,status:'running',startedAt:new Date().toISOString(),goalStages:scenario.steps.map(({id,type})=>({id,type}))};
  for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>{stop.abort();client.pending?.abort.abort();});
  await mkdir(dirname(file),{recursive:true});
  const save=async()=>{Object.assign(report,{heartbeatAt:new Date().toISOString(),final:client.snapshot(),expedition:expedition?.snapshot(),activeAction,totalActions,actions:actions.slice(-25)});await writeFile(file+'.tmp',JSON.stringify(report));await rename(file+'.tmp',file);};
  try{
    await client.connect();await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
    if(client.state.gameMode!=='survival'||client.state.dimension!=='minecraft:overworld'||Object.keys(client.inventory.snapshot()).length||Object.values(client.inventory.equipment()).some(Boolean))throw new Error('Use a new Survival player with empty inventory and equipment in the Overworld.');
    expedition=createEndExpedition({client,worldId,scenario});
    expedition.brain.on('action:start',e=>{activeAction=e.action;});
    expedition.brain.on('action:finish',e=>{totalActions++;actions.push(e);if(actions.length>25)actions.shift();activeAction=null;console.log(e.skill,e.outcome,e.detail);});
    while(!stop.signal.aborted&&client.state.status==='ready'&&!client.connectionAbort.signal.aborted){
      await expedition.brain.tick();
      if(Date.now()-lastSave>2000){await save();lastSave=Date.now();}
      if(expedition.controller.snapshot().status==='completed'){report.goalAchieved=client.endgame.dragonDeath?.confirmed===true&&client.endgame.dragonDeath?.ownDamageConfirmed===true;break;}
      await delay(100,undefined,{signal:stop.signal});
    }
    report.status=report.goalAchieved?'passed':'incomplete';
  }catch(error){report.status=stop.signal.aborted?'stopped':'failed';report.reason=error.message;}
  finally{await expedition?.brain.stop();report.finishedAt=new Date().toISOString();await save();await client.close();console.log(report.status);}
}
