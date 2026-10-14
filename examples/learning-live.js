import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createOMConnect,planRoute} from '../omconnect/index.js';
import {createMinecraftBrain,createTaskQueue,createNeuralNavigator} from '../overmindmc.js';

// The launcher records evidence. Learning and task execution live in the library.
const worldId=process.env.MC_WORLD||'local-survival',client=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_USER||'AtlasLearning',version:'1.21.1'});
const report={version:'0.6.0',startedAt:new Date().toISOString(),status:'incomplete',stages:[]},signal=AbortSignal.timeout(120000);let brain;
try{
  await client.connect();report.stages.push({name:'connect',status:'passed',dimension:client.state.dimension});
  await client.waitFor(()=>client.recipeBook.received,{signal,event:'recipes',timeoutMs:10000});
  const before=client.recipeBook.snapshot(),recipe=client.recipeBook.recipesFor('crafting_table');
  if(!recipe.length)throw new Error("The server didn't announce the verstack recipe.");
  report.stages.push({name:'lazy-recipes',status:before.indexedOutputs===0?'passed':'failed',before,after:client.recipeBook.snapshot()});
  const start=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(client.state.position[k])])),candidates=[];
  for(const [x,z]of [[5,0],[-5,0],[0,5],[0,-5],[4,4],[-4,-4]])for(const y of [0,1,-1]){
    const goal={x:start.x+x,y:start.y+y,z:start.z+z};
    const path=planRoute({start,goal,getBlock:p=>client.world.blockAt(p),maxDistance:16,maxNodes:1000});if(path.status==='planned')candidates.push({goal,cost:path.cost});
  }
  candidates.sort((a,b)=>a.cost-b.cost);if(!candidates.length)throw new Error("No confirmed short route at the point of entry.");
  const tasks=createTaskQueue({skills:client.describe().skills,tasks:[candidates[0].goal,start,candidates[0].goal].map((goal,i)=>({id:'walk-'+i,title:'Observed route '+(i+1),type:'action',action:{skill:'navigate',args:{...goal,range:0,bridge:false}}}))});
  brain=createMinecraftBrain({client,worldId,survival:false,storage:false,loot:false,needs:false,night:false,hunting:false,equipment:false,defense:{attackPlayers:false},reactors:[tasks.reactor]});tasks.attach(brain);brain.start();
  await client.waitFor(()=>tasks.snapshot().every(t=>t.status==='completed')||tasks.snapshot().some(t=>t.status==='failed'),{signal,event:'physics',timeoutMs:60000});await brain.stop();
  report.stages.push({name:'task-navigation',status:tasks.snapshot().every(t=>t.status==='completed')?'passed':'failed',tasks:tasks.snapshot(),position:client.state.position});
  const memory=brain.neural.export(),directory=resolve('data');await mkdir(directory,{recursive:true});const file=resolve(directory,'learning-live-memory.json');await writeFile(file,JSON.stringify(memory),'utf8');
  const restored=createNeuralNavigator({worldId,memory:JSON.parse(await readFile(file,'utf8'))});
  report.stages.push({name:'neural-persistence',status:memory.samples>=8&&restored.snapshot().samples===memory.samples?'passed':'failed',samples:memory.samples,updates:memory.updates});
  report.status=report.stages.every(s=>s.status==='passed')?'passed':'incomplete';
}catch(error){report.error=String(error.message);}finally{
  await brain?.stop();await client.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/learning-live-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
}
