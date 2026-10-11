import {createKudoConnect,KUDO_SKILLS} from '../kudoconnect/index.js';
import {MCKUDO,createEndExpedition,endExpeditionScenario,dragonExpeditionScenario,validateScenario} from '../mckudo_core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const dragon=process.argv.includes('--dragon');
const scenario=validateScenario(dragon?dragonExpeditionScenario():endExpeditionScenario());
const required=['dig','collect','craft','ensureStation','smelt','combat','navigate','place','ignitePortal','enterPortal','throwEye','fillEndFrame'];
if(dragon)required.push('pillar','descendPillar','shoot','evade');
if(required.some(s=>!KUDO_SKILLS.includes(s)))throw new Error('Отсутствуют исполнители экспедиции.');
if(process.argv.includes('--check')){
  console.log(JSON.stringify({status:'configuration-valid',steps:scenario.steps.map(s=>s.id),skills:required,liveTest:false},null,2));
}else{
  const minutes=Number(process.env.MC_TEST_MINUTES||120),port=Number(process.env.MC_PORT||25565);
  if(!Number.isFinite(minutes)||minutes<1||minutes>480)throw new Error('MC_TEST_MINUTES: 1–480.');
  const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port,username:process.env.MC_NAME||'EndRunner',auth:'offline',version:'1.21.1'});
  const resumed=process.env.MC_RESUME==='1';
  const report={version:MCKUDO.version,objective:dragon?'defeat-dragon':'enter-end',startedAt:new Date().toISOString(),status:'running',resumed,fromZero:false,goalAchieved:false,playersObserved:[],actions:[],checkpoints:[],warnings:[],evidence:[]};
  const stop=new AbortController(),file=process.env.MC_REPORT||(dragon?'data/dragon-expedition.json':'data/end-expedition.json');let expedition;
  process.once('SIGINT',()=>stop.abort(new Error('Остановлено пользователем.')));
  await mkdir('data',{recursive:true});
  const save=()=>writeFile(file,JSON.stringify(report,null,2));
  try{
    client.on('warning',e=>report.warnings.push(String(e.message).slice(0,300)));
    for(const name of ['pillarStep','crystalDestroyed','dragonDefeated'])client.on(name,e=>report.evidence.push({event:name,...e}));
    client.on('entity',e=>{if(e.kind==='player'&&!report.playersObserved.includes(e.username||e.id))report.playersObserved.push(e.username||e.id);});
    await client.connect();await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
    report.initial=client.snapshot();
    report.fromZero=Object.keys(report.initial.inventory).length===0&&Object.values(report.initial.equipment).every(i=>!i);
    if(!resumed&&!report.fromZero||![0,'survival'].includes(client.state.gameMode)||client.state.status!=='ready')throw new Error('Нужен живой новый игрок в Survival с пустым инвентарём и без брони. Используй новое MC_NAME. Для отдельного продолжения разрешён MC_RESUME=1; оно не подтверждает прохождение с нуля.');
    expedition=createEndExpedition({client,worldId:process.env.MC_WORLD_ID||'local-end-expedition',scenario});
    let startedAction=null;
    expedition.brain.on('action:start',e=>{startedAction=e.action;});
    expedition.brain.on('action:finish',e=>{const entry={...e,action:startedAction,position:{...client.state.position},inventory:client.inventory.snapshot()};report.actions.push(entry);if(report.actions.length>5000)report.actions.shift();console.log(JSON.stringify(entry));startedAction=null;});
    const deadline=Date.now()+minutes*60000;let previous;
    while(Date.now()<deadline&&!stop.signal.aborted&&!client.connectionAbort.signal.aborted&&client.state.status==='ready'){
      await expedition.brain.tick();
      report.expedition=expedition.snapshot();report.computation=expedition.brain.computation?.snapshot();report.final=client.snapshot();report.endgame=structuredClone(client.endgame);
      const stage=report.expedition.scenario;
      if(previous!==stage.current){report.checkpoints.push({at:new Date().toISOString(),...stage,dimension:client.state.dimension});previous=stage.current;console.log(JSON.stringify(stage));}
      await save();
      if(stage.status==='completed'&&client.state.dimension==='minecraft:the_end'&&(!dragon||client.endgame.dragonDeath?.confirmed&&client.endgame.dragonDeath?.ownDamageConfirmed)){report.goalAchieved=true;break;}
      if(dragon&&stage.status==='completed'&&!client.endgame.dragonDeath?.ownDamageConfirmed){report.reason='Дракон погиб, но урон этого агента не подтверждён.';break;}
      await delay(100,undefined,{signal:stop.signal});
    }
    report.status=report.goalAchieved?'passed':'incomplete';
    if(!report.goalAchieved)report.reason??=stop.signal.aborted?'Остановлено пользователем.':client.connectionAbort.signal.aborted?client.connectionAbort.signal.reason.message:client.state.status!=='ready'?'Агент погиб или потерял соединение.':'Истёк бюджет испытания; смотри текущий этап и ошибки действий.';
  }catch(error){report.status=stop.signal.aborted?'interrupted':'failed';report.reason=error.message;}
  finally{
    await expedition?.brain.stop();report.computation=expedition?.brain.computation?.snapshot();report.final=client.snapshot();report.finishedAt=new Date().toISOString();
    report.noOtherPlayersObserved=report.playersObserved.length===0;await client.close();await save();
    console.log(JSON.stringify({status:report.status,goalAchieved:report.goalAchieved,fromZero:report.fromZero,report:file,reason:report.reason}));
    process.exitCode=report.goalAchieved?0:1;
  }
}
