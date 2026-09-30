import {createKudoConnect,KUDO_SKILLS} from '../kudoconnect/index.js';
import {createEndExpedition,endExpeditionScenario,validateScenario} from '../mckudo_core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const scenario=validateScenario(endExpeditionScenario());
const required=['dig','collect','craft','ensureStation','smelt','combat','navigate','place','ignitePortal','enterPortal','throwEye','fillEndFrame'];
if(required.some(s=>!KUDO_SKILLS.includes(s)))throw new Error('Отсутствуют исполнители экспедиции.');
if(process.argv.includes('--check')){
  console.log(JSON.stringify({status:'configuration-valid',steps:scenario.steps.map(s=>s.id),skills:required,liveTest:false},null,2));
}else{
  const minutes=Number(process.env.MC_TEST_MINUTES||120),port=Number(process.env.MC_PORT||25565);
  if(!Number.isFinite(minutes)||minutes<1||minutes>480)throw new Error('MC_TEST_MINUTES: 1–480.');
  const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port,username:process.env.MC_NAME||'EndRunner',auth:'offline',version:'1.21.1'});
  const report={version:'0.5.0',startedAt:new Date().toISOString(),status:'running',fromZero:false,goalAchieved:false,playersObserved:[],actions:[],checkpoints:[],warnings:[]};
  const stop=new AbortController(),file=process.env.MC_REPORT||'data/end-expedition.json';let expedition;
  process.once('SIGINT',()=>stop.abort(new Error('Остановлено пользователем.')));
  await mkdir('data',{recursive:true});
  const save=()=>writeFile(file,JSON.stringify(report,null,2));
  try{
    client.on('warning',e=>report.warnings.push(String(e.message).slice(0,300)));
    client.on('entity',e=>{if(e.kind==='player'&&!report.playersObserved.includes(e.username||e.id))report.playersObserved.push(e.username||e.id);});
    await client.connect();await delay(1000);
    report.initial=client.snapshot();
    report.fromZero=Object.keys(report.initial.inventory).length===0&&Object.values(report.initial.equipment).every(i=>!i);
    if(!report.fromZero||![0,'survival'].includes(client.state.gameMode)||client.state.status!=='ready')throw new Error('Нужен живой новый игрок в Survival с пустым инвентарём и без брони. Используй новое MC_NAME.');
    expedition=createEndExpedition({client,worldId:process.env.MC_WORLD_ID||'local-end-expedition',scenario});
    expedition.brain.on('action:finish',e=>{report.actions.push(e);if(report.actions.length>5000)report.actions.shift();console.log(JSON.stringify(e));});
    const deadline=Date.now()+minutes*60000;let previous;
    while(Date.now()<deadline&&!stop.signal.aborted&&client.state.status==='ready'){
      await expedition.brain.tick();
      report.expedition=expedition.snapshot();report.final=client.snapshot();
      const stage=report.expedition.scenario;
      if(previous!==stage.current){report.checkpoints.push({at:new Date().toISOString(),...stage,dimension:client.state.dimension});previous=stage.current;console.log(JSON.stringify(stage));}
      await save();
      if(stage.status==='completed'&&client.state.dimension==='minecraft:the_end'){report.goalAchieved=true;break;}
      await delay(100,undefined,{signal:stop.signal});
    }
    report.status=report.goalAchieved?'passed':'incomplete';
    if(!report.goalAchieved)report.reason=stop.signal.aborted?'Остановлено пользователем.':client.state.status!=='ready'?'Агент погиб или потерял соединение.':'Истёк бюджет испытания; смотри текущий этап и ошибки действий.';
  }catch(error){report.status=stop.signal.aborted?'interrupted':'failed';report.reason=error.message;}
  finally{
    await expedition?.brain.stop();report.final=client.snapshot();report.finishedAt=new Date().toISOString();
    report.noOtherPlayersObserved=report.playersObserved.length===0;await client.close();await save();
    console.log(JSON.stringify({status:report.status,goalAchieved:report.goalAchieved,fromZero:report.fromZero,report:file,reason:report.reason}));
    process.exitCode=report.goalAchieved?0:1;
  }
}
