import {mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {OVERMIND,createMinecraftAgent,validateScenario} from '../overmindmc.js';
import {minecraftCurriculumStages} from '../src/intelligence.js';

const options=Object.fromEntries(process.argv.slice(2).map(value=>{const match=/^--(tier|minutes|name|output)=(.+)$/.exec(value);if(!match)throw new Error(`Unknown argument ${value}`);return [match[1],match[2]];}));
const tier=options.tier||'stone',definitions=minecraftCurriculumStages({tier}),name=options.name||process.env.MC_USER||'ArthasTrial01',minutes=Number(options.minutes||8),directory=resolve(options.output||'data/arthas-live');
for(const definition of definitions)validateScenario({schemaVersion:1,name:definition.title,steps:[{id:definition.id,type:'resources',targets:definition.targets}]});
if(!Number.isFinite(minutes)||minutes<=0||minutes>180)throw new Error('minutes: 0..180');await mkdir(directory,{recursive:true});
const connection={host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:process.env.MC_VERSION||'1.21.1',auth:'offline'};
const agent=createMinecraftAgent({name,worldId:process.env.MC_WORLD||'arthas-curriculum-local',connection,
  brainOptions:{storage:false,night:false,hunting:false,defense:{attackPlayers:false}}});
const controller=new AbortController(),stop=()=>controller.abort(new Error('Curriculum trial stopped')),timer=setTimeout(()=>controller.abort(new Error('Live curriculum time budget reached')),minutes*60000);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const report={schemaVersion:1,version:OVERMIND.version,versionName:OVERMIND.versionName,displayVersion:OVERMIND.displayVersion,scope:'native Minecraft curriculum, not a transferred headless DQN policy',name,connection,startedAt:new Date().toISOString(),status:'incomplete',fromZero:false,definitions,stages:[],actions:[],interventions:[],corrections:[]};
const save=async()=>{await writeFile(resolve(directory,'report.json.tmp'),JSON.stringify(report,null,2)+'\n');await rename(resolve(directory,'report.json.tmp'),resolve(directory,'report.json'));};
let recording=Promise.resolve();const enqueueSave=()=>{recording=recording.then(save).catch(error=>console.error('REPORT',error.message));};
agent.client.on('action',event=>{if(report.actions.length<4096)report.actions.push({...event,at:Date.now(),position:{...agent.client.state.position},inventory:agent.client.inventory.snapshot()});console.log('ACTION',event.skill,event.outcome,event.detail||'');});
agent.client.on('correction',event=>{if(report.corrections.length<256)report.corrections.push(event);});
const progress=setInterval(()=>{const s=agent.snapshot();report.progress={at:Date.now(),stage:report.stages.at(-1)?.id,health:s.state.health,position:s.state.position,inventory:s.inventory,performance:s.brain?.performance};enqueueSave();console.log('PROGRESS',JSON.stringify(report.progress));},15000);progress.unref();
try{
  await agent.connect();controller.signal.throwIfAborted();const c=agent.client;report.initial=agent.snapshot();
  if(c.state.gameMode!=='survival')throw new Error(`Survival required, observed ${c.state.gameMode}`);
  if(Object.values(c.inventory.snapshot()).some(n=>n>0)||Object.values(c.inventory.equipment()).some(Boolean))throw new Error('Use a fresh nickname: curriculum test requires empty inventory and equipment');
  report.fromZero=true;await c.waitFor(()=>c.recipeBook.received,{event:'recipes',timeoutMs:10000,signal:controller.signal});enqueueSave();
  for(const definition of definitions){controller.signal.throwIfAborted();const stage={id:definition.id,title:definition.title,startedAt:new Date().toISOString(),status:'running'};report.stages.push(stage);enqueueSave();console.log('STAGE',stage.id,stage.title);
    try{await agent.run({schemaVersion:1,name:definition.title,steps:[{id:definition.id,type:'resources',targets:definition.targets}]},{timeoutMs:definition.timeoutMs,signal:controller.signal});stage.status='passed';stage.inventory=c.inventory.snapshot();stage.equipment=c.inventory.equipment();stage.position={...c.state.position};stage.finishedAt=new Date().toISOString();enqueueSave();}
    catch(error){stage.status='failed';stage.error=error.message;throw error;}
  }
  report.status='passed';
}catch(error){report.error=error.message;}
finally{
  clearInterval(progress);clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  try{await agent.pause();report.final=agent.snapshot();}catch(error){report.cleanupError=error.message;}finally{await agent.close();}
  report.finishedAt=new Date().toISOString();await recording;await save();console.log('RESULT',JSON.stringify({status:report.status,fromZero:report.fromZero,stages:report.stages.map(s=>({id:s.id,status:s.status})),error:report.error,report:resolve(directory,'report.json')}));if(report.status!=='passed')process.exitCode=1;
}
