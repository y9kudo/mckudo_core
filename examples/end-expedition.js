import {createOMConnect,OM_SKILLS} from '../omconnect/index.js';
import {OVERMIND,createEndExpedition,endExpeditionScenario,dragonExpeditionScenario,fullExpeditionScenario,validateScenario} from '../overmindmc.js';
import {appendFile,mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const dragon=process.argv.includes('--dragon');
const full=process.argv.includes('--full');
const scenario=validateScenario(full?fullExpeditionScenario():dragon?dragonExpeditionScenario():endExpeditionScenario());
const required=['dig','collect','craft','ensureStation','smelt','combat','navigate','place','ignitePortal','enterPortal','throwEye','fillEndFrame'];
if(dragon)required.push('pillar','descendPillar','shoot','evade');
if(full)required.push('barter','equipArmor','bridgeTo');
if(required.some(s=>!OM_SKILLS.includes(s)))throw new Error("No expeditionaries.");
if(process.argv.includes('--check')){
  console.log(JSON.stringify({status:'configuration-valid',steps:scenario.steps.map(s=>s.id),skills:required,liveTest:false},null,2));
}else{
  const minutes=Number(process.env.MC_TEST_MINUTES??120),port=Number(process.env.MC_PORT||25565);
  if(!Number.isFinite(minutes)||minutes<0)throw new Error("MC_TEST_MINUTES: 0 (No term) or positive.");
  const autoRespawn=process.env.MC_AUTO_RESPAWN==='1',maxDeaths=Number(process.env.MC_MAX_DEATHS??3);
  if(!Number.isInteger(maxDeaths)||maxDeaths<0||maxDeaths>1000)throw new Error("MC_MAX_DEATHS: an integer 0–1000.");
  const player=process.env.MC_NAME||'EndRunner',worldId=process.env.MC_WORLD_ID||'local-end-expedition',host=process.env.MC_HOST||'127.0.0.1',version=process.env.MC_VERSION||'1.21.1';
  const client=createOMConnect({host,port,username:player,auth:'offline',version});
  const resumed=process.env.MC_RESUME==='1';
  const stop=new AbortController(),file=process.env.MC_REPORT||(dragon?'data/dragon-expedition.json':'data/end-expedition.json');let expedition;
  const eventsFile=process.env.MC_EVENTS||file.replace(/\.json$/i,'')+'.events.ndjson';
  const memoryFile=process.env.MC_MEMORY||file.replace(/\.json$/i,'')+'.memory.json';
  const stopFile=process.env.MC_STOP_FILE||file.replace(/\.json$/i,'')+'.stop';
  let previous=null;
  if(resumed){previous=JSON.parse(await readFile(file,'utf8'));}
  if(previous&&(previous.player!==player||previous.worldId!==worldId||previous.port!==port||previous.host!==host||previous.minecraftVersion!==version||previous.full!==full))throw new Error("The continuation report is from another player, peace, server, version or scenario.");
  const report={version:OVERMIND.version,objective:dragon?'defeat-dragon':'enter-end',player,worldId,port,startedAt:new Date().toISOString(),status:'running',resumed,autoRespawn,maxDeaths,fromZero:false,originFromZero:previous?.originFromZero??previous?.fromZero??false,previousSegment:previous?{startedAt:previous.startedAt,finishedAt:previous.finishedAt,status:previous.status,stage:previous.expedition?.scenario?.current}:null,goalAchieved:false,playersObserved:[],actions:[],checkpoints:[],warnings:[],evidence:[],deaths:[],failureCounts:{}};
  Object.assign(report,{segmentId:randomUUID(),host,minecraftVersion:version,full,releaseEligible:false,largeUnexplainedCorrections:previous?.largeUnexplainedCorrections||[],externalInterventions:previous?.externalInterventions||[]});
  let journalWrites=Promise.resolve();
  const journal=entry=>{journalWrites=journalWrites.then(()=>appendFile(eventsFile,JSON.stringify({at:new Date().toISOString(),segmentId:report.segmentId,...entry})+'\n')).catch(error=>{report.journalError=error.message;});};
  process.once('SIGINT',()=>stop.abort(new Error("Stopped by the user.")));
  process.once('SIGTERM',()=>stop.abort(new Error("The process has been stopped.")));
  stop.signal.addEventListener('abort',()=>{client.pending?.abort.abort(stop.signal.reason);void expedition?.brain.pause();},{once:true});
  await mkdir('data',{recursive:true});
  for(const path of [file,eventsFile,memoryFile])await mkdir(dirname(path),{recursive:true});
  const atomic=async(path,value)=>{const temp=path+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);};
  const save=()=>atomic(file,report);
  const saveMemory=()=>expedition?atomic(memoryFile,{worldId,player,host,port,minecraftVersion:version,cognition:expedition.brain.cognition?.export(),navigation:expedition.brain.neural?.export(),checkpoint:expedition.controller.exportMemory()}):Promise.resolve();
  const controlTimer=setInterval(()=>{if(existsSync(stopFile)&&!stop.signal.aborted){journal({type:'stop-request',file:stopFile});stop.abort(new Error("Stopped by control file."));}},1000);
  const respawn=async phase=>{
    if(!autoRespawn||report.deaths.length>=maxDeaths)return false;
    const death={at:new Date().toISOString(),phase,position:{...client.state.position},inventory:client.inventory.snapshot()};
    report.deaths.push(death);journal({type:'death',...death});await save();
    await client.respawn();expedition?.controller.restart();journal({type:'respawn',position:{...client.state.position},health:client.state.health});return true;
  };
  try{
    client.on('warning',e=>{const message=String(e.message).slice(0,300);report.warnings.push(message);journal({type:'warning',message});});
    client.on('correction',e=>{const d=Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y,e.to.z-e.from.z);journal({type:'server-position-correction',...e,distance:d,dimension:client.state.dimension});if(d>32&&!client.dimensionRequested){report.largeUnexplainedCorrections.push({at:new Date().toISOString(),...e,distance:d});if(report.largeUnexplainedCorrections.length>128)report.largeUnexplainedCorrections.shift();}});
    client.on('attackSent',e=>journal({type:'attack-sent',...e,health:client.state.health}));
    client.on('damage',e=>journal({type:'damage',...e,health:client.state.health,position:client.state.position}));
    for(const name of ['pillarStep','crystalDestroyed','dragonDefeated','barter'])client.on(name,e=>{report.evidence.push({event:name,...e});if(report.evidence.length>1000)report.evidence.shift();journal({type:'evidence',event:name,data:e});});
    client.on('entity',e=>{if(e.kind==='player'&&!report.playersObserved.includes(e.username||e.id))report.playersObserved.push(e.username||e.id);});
    await client.connect();
    if(client.state.status==='dead'&&!await respawn('entry'))throw new Error("Agent is dead; for continuation with re-emerging MC_AUTO_RESPAWN=1.");
    await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
    report.initial=client.snapshot();
    report.fromZero=Object.keys(report.initial.inventory).length===0&&Object.values(report.initial.equipment).every(i=>!i);
    if(!resumed)report.originFromZero=report.fromZero;
    if(!resumed&&(!report.fromZero||client.state.dimension!=='minecraft:overworld')||![0,'survival'].includes(client.state.gameMode)||client.state.status!=='ready')throw new Error("We need a new player alive Survival In a normal world with empty equipment and no armor. Use the new one MC_NAME. You need a previous report to continue, and MC_RESUME=1.");
    journal({type:'start',player,worldId,resumed,fromZero:report.fromZero,originFromZero:report.originFromZero,initial:report.initial});
    let memory;
    if(resumed){try{memory=JSON.parse(await readFile(memoryFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(resumed&&!memory?.checkpoint)throw new Error("The scenario reference point is saved to continue.");
    if(memory&&(memory.worldId!==worldId||memory.player!==player||memory.host!==host||memory.port!==port||memory.minecraftVersion!==version))throw new Error("The Agent's Memory is from another world, player or server.");
    report.memoryRestored=!!memory;
    expedition=createEndExpedition({client,worldId,scenario,cognitionMemory:memory?.cognition,neuralMemory:memory?.navigation,checkpoint:memory?.checkpoint});
    let startedAction=null,startedTarget=null;
    expedition.brain.on('action:start',e=>{startedAction=e.action;const target=client.entities.get(Number(e.action?.args?.entityId));startedTarget=target?{id:target.id,name:target.name,position:{...target.position}}:null;});
    expedition.brain.on('action:finish',e=>{const entry={...e,action:startedAction,target:startedTarget,health:client.state.health,food:client.state.food,position:{...client.state.position},inventory:client.inventory.snapshot()};report.actions.push(entry);if(report.actions.length>5000)report.actions.shift();if(e.outcome==='failure'){const key=`${e.skill}: ${e.detail}`;report.failureCounts[key]=(report.failureCounts[key]||0)+1;}journal({type:'action',...entry});console.log(JSON.stringify(entry));startedAction=null;startedTarget=null;});
    const deadline=minutes===0?Infinity:Date.now()+minutes*60000;let previousStage,lastSave=0,lastMemorySave=0,lastStopCheck=0;
    while(Date.now()<deadline&&!stop.signal.aborted&&client.client?.state==='play'){
      if(Date.now()-lastStopCheck>=2000){lastStopCheck=Date.now();if(existsSync(stopFile)){stop.abort(new Error("Stopped by control file."));journal({type:'stop-request',file:stopFile});break;}}
      if(client.state.status==='dead'){if(await respawn('during-run'))continue;break;}
      if(client.connectionAbort.signal.aborted||client.state.status!=='ready')break;
      try{await expedition.brain.tick();}catch(error){if(client.state.status==='dead'&&autoRespawn)continue;throw error;}
      report.expedition=expedition.snapshot();report.computation=expedition.brain.computation?.snapshot();report.final=client.snapshot();report.endgame=structuredClone(client.endgame);
      const stage=report.expedition.scenario;
      if(previousStage!==stage.current){const checkpoint={at:new Date().toISOString(),...stage,dimension:client.state.dimension};report.checkpoints.push(checkpoint);journal({type:'checkpoint',checkpoint});previousStage=stage.current;console.log(JSON.stringify(stage));}
      if(Date.now()-lastSave>=2000){await save();lastSave=Date.now();}
      if(Date.now()-lastMemorySave>=30000){await saveMemory();lastMemorySave=Date.now();}
      if(stage.status==='completed'&&client.state.dimension==='minecraft:the_end'&&(!dragon||client.endgame.dragonDeath?.confirmed&&client.endgame.dragonDeath?.ownDamageConfirmed)){report.goalAchieved=true;break;}
      if(dragon&&stage.status==='completed'&&!client.endgame.dragonDeath?.ownDamageConfirmed){report.reason="The dragon died, But the damage to this agent is not confirmed.";break;}
      await delay(100,undefined,{signal:stop.signal});
    }
    report.status=report.goalAchieved?'passed':'incomplete';
    if(!report.goalAchieved)report.reason??=stop.signal.aborted?"Stopped by the user.":client.connectionAbort.signal.aborted?client.connectionAbort.signal.reason.message:client.state.status!=='ready'?"Agent killed or lost connection.":"Test budget expired; Look at the current stage and errors.";
  }catch(error){report.status=stop.signal.aborted?'interrupted':'failed';report.reason=error.message;}
  finally{
    clearInterval(controlTimer);
    await expedition?.brain.stop();try{await saveMemory();}catch(error){report.memoryError=error.message;}report.computation=expedition?.brain.computation?.snapshot();report.final=client.snapshot();report.finishedAt=new Date().toISOString();
    report.noOtherPlayersObserved=report.playersObserved.length===0;journal({type:'finish',status:report.status,reason:report.reason,goalAchieved:report.goalAchieved,final:report.final});await journalWrites;await client.close();await save();
    console.log(JSON.stringify({status:report.status,goalAchieved:report.goalAchieved,fromZero:report.fromZero,report:file,reason:report.reason}));
    process.exitCode=report.goalAchieved?0:1;
  }
}
