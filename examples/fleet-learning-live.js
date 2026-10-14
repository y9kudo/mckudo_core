/** A team of real clients. The test assigns a goal and records evidence; decisions live in the libraries. */
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createAgentManager,createMinecraftBrain,startDashboard} from '../overmindmc.js';
import {DEFAULT_AGENT_NAMES} from '../omconnect/index.js';

const count=Number(process.env.MC_COUNT||20),names=process.env.MC_NAMES?process.env.MC_NAMES.split(','):DEFAULT_AGENT_NAMES.slice(0,count);
const minutes=Number(process.env.MC_TEST_MINUTES||8),worldId=process.env.MC_WORLD;
if(!Number.isInteger(count)||count<2||count>20||names.length!==count||!worldId||!Number.isFinite(minutes)||minutes<1||minutes>30)throw new Error("Requires MC_WORLD, MC_COUNT 2–20, corresponding number of names and MC_TEST_MINUTES 1–30.");
const manager=createAgentManager({count,names,worldId,memoryDirectory:'data/fleet-learning-memory',connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1'},
  createBrain:options=>createMinecraftBrain({...options,config:{tickIntervalMs:200,actionTimeoutMs:30000},storage:false,night:false,hunting:false,needs:false,defense:{attackPlayers:false},survival:{...options.survival,targets:{'minecraft:wooden_pickaxe':1}}})});
const report={version:'0.6.0',worldId,count,startedAt:new Date().toISOString(),status:'running',goal:'Each agent crafts or receives a wooden pickaxe',phase:'connect',agents:{},coordination:{messages:0,claims:0,bidders:[],topics:{}},transfers:[]};
const abort=new AbortController();let dashboard,saved=Promise.resolve(),finished=false;
await mkdir('data',{recursive:true});
const save=()=>{const data=JSON.stringify(report,null,2);saved=saved.catch(()=>{}).then(async()=>{await writeFile('data/fleet-learning-live.json.tmp',data);await rename('data/fleet-learning-live.json.tmp','data/fleet-learning-live.json');});return saved;};
const stop=async()=>{abort.abort();if(finished)await dashboard?.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
  dashboard=await startDashboard({manager,port:Number(process.env.MC_DASHBOARD_PORT||4180)});console.log('Dashboard',dashboard.url);
  const seen=new Set(),bidders=new Set();
  for(const [name,peer]of manager.fleet.peers)peer.on('message',e=>{const id=e.from+'/'+e.sequence;if(seen.has(id))return;seen.add(id);if(seen.size>10000)seen.delete(seen.values().next().value);report.coordination.messages++;report.coordination.topics[e.topic]=(report.coordination.topics[e.topic]||0)+1;if(e.topic==='intent'&&!e.payload.release){report.coordination.claims++;bidders.add(e.from);report.coordination.bidders=[...bidders];}});
  for(const name of names){
    abort.signal.throwIfAborted();const entry=manager.entries.get(name),c=entry.client,r=report.agents[name]={actions:{},errors:[],warnings:[],samples:0,updates:0,goalAchieved:false};
    c.on('action',e=>{const key=e.skill+'/'+e.outcome;r.actions[key]=(r.actions[key]||0)+1;if(e.outcome==='failure'){r.errors.push({at:Date.now(),skill:e.skill,detail:e.detail});if(r.errors.length>20)r.errors.shift();}});
    c.on('warning',e=>{r.warnings.push(String(e.message).slice(0,200));if(r.warnings.length>10)r.warnings.shift();});
    await manager.execute(name,'connect');await c.waitFor(()=>c.recipeBook.received,{event:'recipes',timeoutMs:10000});r.initial=c.snapshot();
    console.log(name,'connected',JSON.stringify(c.state.position));await save();
  }
  report.fromEmptyInventory=Object.values(report.agents).every(r=>Object.keys(r.initial.inventory).length===0);
  report.phase='cooperative-resource-goal';
  for(const name of names){await manager.execute(name,'goal',{target:'wood'});await manager.execute(name,'start');await delay(200,undefined,{signal:abort.signal});}
  const deadline=Date.now()+minutes*60000,seenTrades=new Set();
  while(Date.now()<deadline&&!abort.signal.aborted){
    let completed=0;
    for(const [name,e]of manager.entries){const r=report.agents[name],c=e.client,m=e.brain?.cognition?.snapshot();r.final=c.snapshot();r.plan=e.brain?.survival?.snapshot();r.samples=m?.samples||0;r.updates=m?.updates||0;r.navigation=e.brain?.neural?.snapshot();r.goalAchieved=c.inventory.count('wooden_pickaxe')>0;if(r.goalAchieved)completed++;}
    for(const e of manager.snapshot().log.filter(e=>e.event==='trade'||e.event==='trade-error')){const key=e.at+'/'+e.name;if(!seenTrades.has(key)){seenTrades.add(key);report.transfers.push(e);}}
    report.completed=completed;await save();console.log(JSON.stringify({completed,total:count,messages:report.coordination.messages,samples:Object.values(report.agents).reduce((n,r)=>n+r.samples,0)}));
    if(completed===count||[...manager.entries.values()].every(e=>e.client.state.status!=='ready'))break;
    await delay(10000,undefined,{signal:abort.signal});
  }
  report.status=report.completed===count&&report.coordination.bidders.length>=2?'passed':'incomplete';
}catch(error){report.status=abort.signal.aborted?'cancelled':'failed';report.error=String(error.message);}
finally{
  await Promise.allSettled(names.map(name=>manager.execute(name,'pause')));
  for(const [name,e]of manager.entries)if(report.agents[name]){report.agents[name].final=e.client.snapshot();report.agents[name].samples=e.brain?.cognition?.snapshot().samples||0;report.agents[name].updates=e.brain?.cognition?.snapshot().updates||0;}
  report.finishedAt=new Date().toISOString();report.phase='finished';await save();finished=true;console.log(JSON.stringify({status:report.status,completed:report.completed,report:'data/fleet-learning-live.json',dashboard:dashboard?.url,error:report.error}));
  if(process.env.MC_KEEP_OPEN!=='1'||!dashboard){await dashboard?.close();if(!dashboard)await manager.close();process.exitCode=report.status==='passed'?0:1;}
}
