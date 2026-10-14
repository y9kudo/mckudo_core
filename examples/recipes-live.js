import {mkdir,writeFile} from 'node:fs/promises';
import {createOMConnect} from '../omconnect/index.js';
import {createMinecraftBrain,createScenario,createSurvivalReactor,catalogFromMinecraftData,createTaskQueue,createNeuralPlanner} from '../overmindmc.js';

const client=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_USER||'BlakeRecipes',version:'1.21.1'}),worldId=process.env.MC_WORLD||'local-survival';
const report={version:'0.6.0',status:'incomplete',startedAt:new Date().toISOString(),actions:[]};let brain,queue,current;
client.on('action',e=>{report.actions.push({...e,args:current?.args,inventory:client.inventory.snapshot(),position:client.state.position});console.log(e.skill,e.outcome,e.detail);});
try{
  await client.connect();report.initial=client.inventory.snapshot();report.worldId=worldId;
  if(Object.keys(report.initial).length)throw new Error("For verification with empty equipment, you need a new agent name.");
  await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:10000});
  const catalog=catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook});
  const scenario={schemaVersion:1,name:'Observed resources and server crafting',steps:[{id:'logs',type:'resources',targets:{'#logs':1}},{id:'table',type:'resources',targets:{'minecraft:crafting_table':1}},{id:'pickaxe',type:'resources',targets:{'minecraft:wooden_pickaxe':1}}]};
  queue=createTaskQueue({skills:client.describe().skills,tasks:[{id:'crafting',title:'Wood and crafting',type:'scenario',scenario}],scenarioFactory:s=>createScenario({scenario:s,catalog,getBlock:p=>client.world.blockAt(p),resourceFactory:targets=>createSurvivalReactor({client,catalog,targets,priority:20})})});
  brain=createMinecraftBrain({client,worldId,survival:false,storage:false,night:false,hunting:false,needs:false,equipment:false,defense:{attackPlayers:false},reactors:[queue.reactor]});queue.attach(brain);brain.on('action:start',e=>{current=e.action;});brain.start();
  await client.waitFor(()=>queue.snapshot().every(t=>t.status==='completed')||queue.snapshot().some(t=>t.status==='failed'),{event:'physics',timeoutMs:180000});
  const completed=queue.snapshot().every(t=>t.status==='completed'),crafted=report.actions.some(e=>e.skill==='craft'&&e.outcome==='success');report.status=completed&&crafted?'passed':'incomplete';
}catch(error){report.error=String(error.message);}finally{
  await brain?.stop();report.tasks=queue?.snapshot();report.final=client.inventory.snapshot();report.recipes=client.recipeBook.snapshot();report.learning=brain?.neural?.snapshot();report.cognition=brain?.cognition?.snapshot();
  if(brain?.cognition){const memory=brain.cognition.export();report.cognitionRestored=createNeuralPlanner({worldId,memory}).snapshot().samples===report.cognition.samples;}
  await client.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/recipes-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,error:report.error,final:report.final,tasks:report.tasks,recipes:report.recipes,cognition:report.cognition?.samples,cognitionRestored:report.cognitionRestored},null,2));if(report.status!=='passed')process.exitCode=1;
}
