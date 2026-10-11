import { mkdir, writeFile } from 'node:fs/promises';
import { createMinecraftAgent, createAgentMemory, createNeuralPlanner, createSpatialMemory } from '../mckudo_core.js';

// This script supplies goals and records evidence. Resource choices belong to the core.
const name=process.env.MC_USER||'AtlasCore',worldId=process.env.MC_WORLD||'local-survival';
const agent=createMinecraftAgent({name,worldId,memoryDirectory:'data/agents',
  connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1'},
  brainOptions:{storage:false,night:false,hunting:false,defense:{attackPlayers:false}}});
const scenario={schemaVersion:1,name:'From empty inventory to stone tools',steps:[
  {id:'wood',type:'resources',targets:{'#logs':2}},
  {id:'table',type:'resources',targets:{'minecraft:crafting_table':1}},
  {id:'wooden_pickaxe',type:'resources',targets:{'minecraft:wooden_pickaxe':1}},
  {id:'stone_pickaxe',type:'resources',targets:{'minecraft:stone_pickaxe':1}},
  {id:'furnace',type:'resources',targets:{'minecraft:furnace':1}}
]};
const report={version:'0.6.0',name,worldId,startedAt:new Date().toISOString(),status:'incomplete',scenario,actions:[]};
const abort=new AbortController();const stop=()=>abort.abort(new Error('Live test stopped by user.'));
process.once('SIGINT',stop);process.once('SIGTERM',stop);
agent.client.on('action',e=>{
  if(report.actions.length<1024)report.actions.push({...e,position:{...agent.client.state.position},inventory:agent.client.inventory.snapshot()});
  console.log(e.skill,e.outcome,e.detail);
});
const progress=setInterval(()=>{const s=agent.snapshot();console.log('PROGRESS',JSON.stringify({position:s.state.position,health:s.state.health,tasks:s.taskState,inventory:s.inventory.map(i=>({item:i.item,count:i.count}))}));},15000);progress.unref();
try {
  await agent.connect();
  report.initial=agent.client.inventory.snapshot();
  if(Object.keys(report.initial).length)throw new Error('Use a new MC_USER: this test requires an empty inventory.');
  await agent.client.waitFor(()=>agent.client.recipeBook.received,{event:'recipes',timeoutMs:10000});
  const result=await agent.run(scenario,{timeoutMs:Number(process.env.MC_TIMEOUT_MS||480000),signal:abort.signal});
  report.status=result.taskState.every(t=>t.status==='completed')?'passed':'incomplete';
} catch(error) { report.error=String(error.message); }
finally {
  clearInterval(progress);
  await agent.pause();report.final=agent.snapshot();
  await agent.close();
  const saved=await createAgentMemory('data/agents',worldId).load(name);
  report.memoryRestored={
    cognition:!!saved?.cognition&&createNeuralPlanner({worldId,memory:saved.cognition}).snapshot().samples===report.final.cognition?.samples,
    spatial:!!saved?.spatial&&createSpatialMemory({worldId,memory:saved.spatial}).snapshot().entries===report.final.spatial?.entries
  };
  report.finishedAt=new Date().toISOString();
  await mkdir('data',{recursive:true});
  const path=`data/agent-live-${report.startedAt.replace(/[:.]/g,'-')}.json`;
  await writeFile(path,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,error:report.error,report:path,tasks:report.final.taskState,inventory:report.final.inventory,spatial:report.final.spatial,timing:report.final.state.metrics.timing,memoryRestored:report.memoryRestored},null,2));
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  if(report.status!=='passed')process.exitCode=1;
}
