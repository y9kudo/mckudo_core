/** Five native 0.7 agents; the library owns planning, claims, crafting and trades. */
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import protocol from 'minecraft-protocol';
import {OVERMIND,createAgentManager,startDashboard,diamondSetTargets,distributeStorageSupplies} from '../overmindmc.js';

const names=['ArKaDiU656','_FISTFIGHT_','MrGiraffe6614','DERTKE','LazyP1nk'];
const version=process.env.MC_VERSION||'1.21.1',host=process.env.MC_HOST||'127.0.0.1',port=Number(process.env.MC_PORT||25565);
const minutes=Number(process.env.MC_TEST_MINUTES||30),rockets=Number(process.env.MC_ROCKETS_EACH||16);
if(!Number.isFinite(minutes)||minutes<1||minutes>240||!Number.isInteger(rockets)||rockets<1||rockets>64)throw new Error('MC_TEST_MINUTES: 1–240; MC_ROCKETS_EACH: 1–64.');
if(process.argv.includes('--check')){console.log(JSON.stringify({version,host,port,names,goal:diamondSetTargets(),flightKit:{elytra:1,firework_rocket:rockets}}));process.exit(0);}
const report={startedAt:new Date().toISOString(),version:OVERMIND.version,minecraftVersion:version,server:`${host}:${port}`,names,status:'preparing',agents:{},phases:[],coordination:{messages:0,claims:0},transfers:[]};
let manager,dashboard,saveQueue=Promise.resolve();const abort=new AbortController();
await mkdir('data',{recursive:true});
const save=()=>{const json=JSON.stringify(report,null,2);return saveQueue=saveQueue.catch(()=>{}).then(async()=>{await writeFile('data/cooperative-diamonds-live.json.tmp',json);await rename('data/cooperative-diamonds-live.json.tmp','data/cooperative-diamonds-live.json');});};
process.once('SIGINT',()=>abort.abort(new Error("Trial stopped.")));
process.once('SIGTERM',()=>abort.abort(new Error("Trial stopped.")));
try{
  const status=await protocol.ping({host,port,closeTimeout:5000});report.serverStatus={version:status.version,players:status.players,latency:status.latency};
  if(status.version?.name!==version)throw new Error(`The server reports ${status.version?.name}, requested ${version}.`);
  if(status.players.max-status.players.online<names.length)throw new Error("There aren't enough slots available on the server for five agents.");
  let createClient;
  if(version==='26.3')({create263Client:createClient}=await import('./java263-runtime.js'));
  manager=createAgentManager({count:5,names,worldId:process.env.MC_WORLD||`cooperative-diamonds-${version}-2026-10-13`,connection:{host,port,version,auth:'offline',viewDistance:16,maxDrop:12,maxFallDamage:8,fallHealthReserve:8},...(createClient?{createClient}:{}),memoryDirectory:'data/cooperative-diamonds-memory',supplyTargets:{'minecraft:elytra':1,'minecraft:firework_rocket':rockets},brainOptions:{storage:false,defense:{attackPlayers:false},config:{actionTimeoutMs:45000},adapterOptions:{searchRadius:128}}});
  dashboard=await startDashboard({manager,port:Number(process.env.MC_DASHBOARD_PORT||4181)});report.dashboard=dashboard.url;
  console.log(JSON.stringify({phase:'dashboard',url:dashboard.url,names}));
  const seenMessages=new Set();
  for(const peer of manager.fleet.peers.values())peer.on('message',e=>{const key=e.from+'/'+e.sequence;if(seenMessages.has(key))return;seenMessages.add(key);if(seenMessages.size>10000)seenMessages.delete(seenMessages.values().next().value);report.coordination.messages++;if(e.topic==='intent'&&!e.payload.release)report.coordination.claims++;});
  for(const name of names){
    const c=manager.entries.get(name).client,r=report.agents[name]={errors:[],actions:{},milestones:[],deaths:0,respawns:0};
    c.on('action',e=>{r.actions[e.skill+'/'+e.outcome]=(r.actions[e.skill+'/'+e.outcome]||0)+1;if(e.outcome==='failure'){r.errors.push({at:new Date().toISOString(),skill:e.skill,detail:e.detail});r.errors=r.errors.slice(-30);}});
    c.on('warning',e=>{r.errors.push({at:new Date().toISOString(),warning:e.message});r.errors=r.errors.slice(-30);});
    c.on('kicked',reason=>{r.kicked=reason;});
    c.on('death',()=>{r.deaths++;r.lastDeathAt=Date.now();});
    await manager.execute(name,'connect');
    if(c.state.status==='dead'){await manager.execute(name,'respawn');r.respawns++;}
    await c.waitFor(()=>c.recipeBook.received,{event:'recipes',timeoutMs:10000});
    if(c.state.gameMode!=='survival')throw new Error(`${name}: requires Survival, received ${c.state.gameMode}.`);
    r.initial=c.snapshot();console.log(JSON.stringify({phase:'connected',name,position:c.state.position,inventory:c.inventory.snapshot()}));await save();
  }
  await delay(2500,undefined,{signal:abort.signal});
  const clients=[...manager.entries.values()].map(e=>e.client);
  report.initiallyEmpty=clients.every(c=>Object.keys(c.inventory.snapshot()).length===0&&Object.values(c.inventory.equipment()).every(i=>!i));
  try{report.supplies=await distributeStorageSupplies({clients,requests:()=>({elytra:1,firework_rocket:rockets}),radius:64,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(180000)])});}
  catch(error){report.supplies={status:'incomplete',error:error.message};}
  console.log(JSON.stringify({phase:'flight-kit',result:report.supplies}));await save();
  for(const name of names){await manager.execute(name,'goal',{target:'diamond_set'});await manager.execute(name,'start');await delay(150,undefined,{signal:abort.signal});}
  report.status='running';const deadline=Date.now()+minutes*60000,seenTrades=new Set();
  while(Date.now()<deadline&&!abort.signal.aborted){
    let completed=0;
    for(const [name,e]of manager.entries){
      const c=e.client,r=report.agents[name];r.final=c.snapshot();r.plan=e.brain?.survival?.snapshot();
      if(c.state.status==='dead'&&r.respawns<3&&Date.now()-(r.lastDeathAt||0)>10000){
        try{await manager.execute(name,'respawn');r.respawns++;await manager.execute(name,'start');}catch(error){r.errors.push({at:new Date().toISOString(),respawn:error.message});}
      }
      r.goalAchieved=Object.entries(diamondSetTargets()).every(([item,n])=>c.inventory.ownedCount(item)>=n)&&Object.values(c.inventory.equipment()).every(i=>i?.name.startsWith('diamond_'));
      if(r.goalAchieved)completed++;
      for(const item of ['crafting_table','wooden_pickaxe','stone_pickaxe','furnace','iron_pickaxe','diamond',...Object.keys(diamondSetTargets())])if(c.inventory.ownedCount(item)>0&&!r.milestones.includes(item))r.milestones.push(item);
    }
    for(const entry of manager.snapshot().log.filter(e=>e.event==='trade'||e.event==='trade-error')){const key=entry.at+'/'+entry.name;if(!seenTrades.has(key)){seenTrades.add(key);report.transfers.push(entry);}}
    report.completed=completed;await save();
    console.log(JSON.stringify({phase:'progress',completed,total:5,claims:report.coordination.claims,agents:Object.fromEntries(Object.entries(report.agents).map(([name,r])=>[name,{status:r.final.status,health:r.final.health,milestones:r.milestones,stage:r.plan?.stage}]))}));
    if(completed===5||clients.every(c=>c.state.status!=='ready'))break;
    await delay(10000,undefined,{signal:abort.signal});
  }
  report.status=report.completed===5?'passed':'incomplete';
}catch(error){report.status=abort.signal.aborted?'cancelled':'blocked';report.error=error.message;}
finally{
  if(manager)for(const name of names){await manager.execute(name,'pause').catch(()=>{});const e=manager.entries.get(name);if(report.agents[name])report.agents[name].final=e.client.snapshot();}
  report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({phase:'finished',status:report.status,completed:report.completed,error:report.error,report:'data/cooperative-diamonds-live.json'}));
  if(dashboard)await dashboard.close();else await manager?.close();
  process.exitCode=report.status==='passed'?0:1;
}
