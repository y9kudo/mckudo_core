import {createKudoConnect,KUDO_SKILLS} from '../kudoconnect/index.js';
import {MCKUDO,createEndExpedition,endExpeditionScenario,dragonExpeditionScenario,validateScenario} from '../mckudo_core.js';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const dragon=process.argv.includes('--dragon');
const scenario=validateScenario(dragon?dragonExpeditionScenario():endExpeditionScenario());
const required=['dig','collect','craft','ensureStation','smelt','combat','navigate','place','ignitePortal','enterPortal','throwEye','fillEndFrame'];
if(dragon)required.push('pillar','descendPillar','shoot','evade');
if(required.some(s=>!KUDO_SKILLS.includes(s)))throw new Error('Отсутствуют исполнители экспедиции.');
if(process.argv.includes('--check')){
  console.log(JSON.stringify({status:'configuration-valid',steps:scenario.steps.map(s=>s.id),skills:required,liveTest:false},null,2));
}else{
  const minutes=Number(process.env.MC_TEST_MINUTES??120),port=Number(process.env.MC_PORT||25565);
  if(!Number.isFinite(minutes)||minutes<0)throw new Error('MC_TEST_MINUTES: 0 (без срока) или положительное число.');
  const autoRespawn=process.env.MC_AUTO_RESPAWN==='1',maxDeaths=Number(process.env.MC_MAX_DEATHS??3);
  if(!Number.isInteger(maxDeaths)||maxDeaths<0||maxDeaths>1000)throw new Error('MC_MAX_DEATHS: целое число 0–1000.');
  const player=process.env.MC_NAME||'EndRunner',worldId=process.env.MC_WORLD_ID||'local-end-expedition';
  const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port,username:player,auth:'offline',version:'1.21.1'});
  const resumed=process.env.MC_RESUME==='1';
  const stop=new AbortController(),file=process.env.MC_REPORT||(dragon?'data/dragon-expedition.json':'data/end-expedition.json');let expedition;
  const eventsFile=process.env.MC_EVENTS||file.replace(/\.json$/i,'')+'.events.ndjson';
  const memoryFile=process.env.MC_MEMORY||file.replace(/\.json$/i,'')+'.memory.json';
  const stopFile=process.env.MC_STOP_FILE||file.replace(/\.json$/i,'')+'.stop';
  let previous=null;
  if(resumed){try{previous=JSON.parse(await readFile(file,'utf8'));}catch{}}
  if(previous&&(previous.player&&previous.player!==player||previous.worldId&&previous.worldId!==worldId||previous.port&&previous.port!==port))throw new Error('Отчёт продолжения относится к другому игроку, миру или порту.');
  const report={version:MCKUDO.version,objective:dragon?'defeat-dragon':'enter-end',player,worldId,port,startedAt:new Date().toISOString(),status:'running',resumed,autoRespawn,maxDeaths,fromZero:false,originFromZero:previous?.originFromZero??previous?.fromZero??false,previousSegment:previous?{startedAt:previous.startedAt,finishedAt:previous.finishedAt,status:previous.status,stage:previous.expedition?.scenario?.current}:null,goalAchieved:false,playersObserved:[],actions:[],checkpoints:[],warnings:[],evidence:[],deaths:[],failureCounts:{}};
  let journalWrites=Promise.resolve();
  const journal=entry=>{journalWrites=journalWrites.then(()=>appendFile(eventsFile,JSON.stringify({at:new Date().toISOString(),...entry})+'\n')).catch(error=>{report.journalError=error.message;});};
  process.once('SIGINT',()=>stop.abort(new Error('Остановлено пользователем.')));
  await mkdir('data',{recursive:true});
  await mkdir(file.substring(0,file.lastIndexOf('/'))||'.',{recursive:true});
  await mkdir(eventsFile.substring(0,eventsFile.lastIndexOf('/'))||'.',{recursive:true});
  await mkdir(memoryFile.substring(0,memoryFile.lastIndexOf('/'))||'.',{recursive:true});
  const save=()=>writeFile(file,JSON.stringify(report,null,2));
  const saveMemory=()=>expedition?writeFile(memoryFile,JSON.stringify({worldId,cognition:expedition.brain.cognition?.export(),navigation:expedition.brain.neural?.export()})):Promise.resolve();
  const respawn=async phase=>{
    if(!autoRespawn||report.deaths.length>=maxDeaths)return false;
    const death={at:new Date().toISOString(),phase,position:{...client.state.position},inventory:client.inventory.snapshot()};
    report.deaths.push(death);journal({type:'death',...death});await save();
    await client.respawn();journal({type:'respawn',position:{...client.state.position},health:client.state.health});return true;
  };
  try{
    client.on('warning',e=>{const message=String(e.message).slice(0,300);report.warnings.push(message);journal({type:'warning',message});});
    for(const name of ['pillarStep','crystalDestroyed','dragonDefeated'])client.on(name,e=>{report.evidence.push({event:name,...e});journal({type:'evidence',event:name,data:e});});
    client.on('entity',e=>{if(e.kind==='player'&&!report.playersObserved.includes(e.username||e.id))report.playersObserved.push(e.username||e.id);});
    await client.connect();
    if(client.state.status==='dead'&&!await respawn('entry'))throw new Error('Агент мёртв; для продолжения с возрождением включи MC_AUTO_RESPAWN=1.');
    await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
    report.initial=client.snapshot();
    report.fromZero=Object.keys(report.initial.inventory).length===0&&Object.values(report.initial.equipment).every(i=>!i);
    if(!resumed)report.originFromZero=report.fromZero;
    if(!resumed&&!report.fromZero||![0,'survival'].includes(client.state.gameMode)||client.state.status!=='ready')throw new Error('Нужен живой новый игрок в Survival с пустым инвентарём и без брони. Используй новое MC_NAME. Для отдельного продолжения разрешён MC_RESUME=1; оно не подтверждает прохождение с нуля.');
    journal({type:'start',player,worldId,resumed,fromZero:report.fromZero,originFromZero:report.originFromZero,initial:report.initial});
    let memory;
    if(resumed){try{memory=JSON.parse(await readFile(memoryFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(memory&&memory.worldId!==worldId)throw new Error('Память агента относится к другому миру.');
    report.memoryRestored=!!memory;
    expedition=createEndExpedition({client,worldId,scenario,cognitionMemory:memory?.cognition,neuralMemory:memory?.navigation});
    let startedAction=null,startedTarget=null;
    expedition.brain.on('action:start',e=>{startedAction=e.action;const target=client.entities.get(Number(e.action?.args?.entityId));startedTarget=target?{id:target.id,name:target.name,position:{...target.position}}:null;});
    expedition.brain.on('action:finish',e=>{const entry={...e,action:startedAction,target:startedTarget,health:client.state.health,food:client.state.food,position:{...client.state.position},inventory:client.inventory.snapshot()};report.actions.push(entry);if(report.actions.length>5000)report.actions.shift();if(e.outcome==='failure'){const key=`${e.skill}: ${e.detail}`;report.failureCounts[key]=(report.failureCounts[key]||0)+1;}journal({type:'action',...entry});console.log(JSON.stringify(entry));startedAction=null;startedTarget=null;});
    const deadline=minutes===0?Infinity:Date.now()+minutes*60000;let previousStage,lastSave=0,lastMemorySave=0,lastStopCheck=0;
    while(Date.now()<deadline&&!stop.signal.aborted&&client.client?.state==='play'){
      if(Date.now()-lastStopCheck>=2000){lastStopCheck=Date.now();if(existsSync(stopFile)){stop.abort(new Error('Остановлено файлом управления.'));journal({type:'stop-request',file:stopFile});break;}}
      if(client.state.status==='dead'){if(await respawn('during-run'))continue;break;}
      if(client.connectionAbort.signal.aborted||client.state.status!=='ready')break;
      try{await expedition.brain.tick();}catch(error){if(client.state.status==='dead'&&autoRespawn)continue;throw error;}
      report.expedition=expedition.snapshot();report.computation=expedition.brain.computation?.snapshot();report.final=client.snapshot();report.endgame=structuredClone(client.endgame);
      const stage=report.expedition.scenario;
      if(previousStage!==stage.current){const checkpoint={at:new Date().toISOString(),...stage,dimension:client.state.dimension};report.checkpoints.push(checkpoint);journal({type:'checkpoint',checkpoint});previousStage=stage.current;console.log(JSON.stringify(stage));}
      if(Date.now()-lastSave>=2000){await save();lastSave=Date.now();}
      if(Date.now()-lastMemorySave>=30000){await saveMemory();lastMemorySave=Date.now();}
      if(stage.status==='completed'&&client.state.dimension==='minecraft:the_end'&&(!dragon||client.endgame.dragonDeath?.confirmed&&client.endgame.dragonDeath?.ownDamageConfirmed)){report.goalAchieved=true;break;}
      if(dragon&&stage.status==='completed'&&!client.endgame.dragonDeath?.ownDamageConfirmed){report.reason='Дракон погиб, но урон этого агента не подтверждён.';break;}
      await delay(100,undefined,{signal:stop.signal});
    }
    report.status=report.goalAchieved?'passed':'incomplete';
    if(!report.goalAchieved)report.reason??=stop.signal.aborted?'Остановлено пользователем.':client.connectionAbort.signal.aborted?client.connectionAbort.signal.reason.message:client.state.status!=='ready'?'Агент погиб или потерял соединение.':'Истёк бюджет испытания; смотри текущий этап и ошибки действий.';
  }catch(error){report.status=stop.signal.aborted?'interrupted':'failed';report.reason=error.message;}
  finally{
    await expedition?.brain.stop();await saveMemory();report.computation=expedition?.brain.computation?.snapshot();report.final=client.snapshot();report.finishedAt=new Date().toISOString();
    report.noOtherPlayersObserved=report.playersObserved.length===0;journal({type:'finish',status:report.status,reason:report.reason,goalAchieved:report.goalAchieved,final:report.final});await journalWrites;await client.close();await save();
    console.log(JSON.stringify({status:report.status,goalAchieved:report.goalAchieved,fromZero:report.fromZero,report:file,reason:report.reason}));
    process.exitCode=report.goalAchieved?0:1;
  }
}
