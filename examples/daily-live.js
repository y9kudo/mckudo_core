/** Bounded live acceptance, using library policies. No /give, teleport or time commands. */
import {createFleet} from '../omconnect/index.js';
import {createMinecraftBrain,planRoute,shareTeamSupplies} from '../overmindmc.js';
import {sleepTime} from '../packages/omconnect/src/rest.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const names=(process.env.MC_NAMES||'Owen,Liam,Noah').split(',');
if(names.length!==3)throw new Error("MC_NAMES: Three names in a decimal place.");
const fleet=createFleet({count:3,names}),clients=[...fleet.agents.values()],brains=[];
const report={startedAt:new Date().toISOString(),server:'127.0.0.1:25565',status:'running',phases:[],agents:{}};
const selectedPhases=process.env.MC_DAILY_PHASES?.split(',');
const phase=(name,status,evidence)=>{report.phases.push({name,status,evidence});console.log(JSON.stringify({name,status,evidence}));};
const run=async(name,fn)=>{if(selectedPhases&&!selectedPhases.includes(name.split(':')[0]))return;try{const value=await fn();phase(name,'passed',value);}catch(error){phase(name,'blocked',{reason:error.message});}};
const base={storage:false,survival:false,loot:false,needs:false,night:false,hunting:false,adapterOptions:{searchRadius:32}};
const equipment=c=>Object.fromEntries(Object.entries(c.inventory.equipment()).map(([slot,item])=>[slot,item?.name||null]));
const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
try{
  for(const c of clients){
    const r=report.agents[c.options.username]={warnings:[],actions:[]};
    c.on('warning',e=>r.warnings.push(e.message));c.on('action',e=>r.actions.push(e));
    await c.connect();if(c.state.status==='dead')await c.respawn();await c.waitFor(()=>c.state.onGround,{timeoutMs:5000});
    r.initial=c.snapshot();phase('connect:'+c.options.username,'passed',{position:c.state.position,health:c.state.health,time:c.time,inventory:c.inventory.snapshot()});
  }
  await run('team-sharing',async()=>{
    const receipt=await shareTeamSupplies({clients,peers:fleet.peers,maxTransfers:24,signal:AbortSignal.timeout(180000)});
    if(receipt.status!=='completed'||!receipt.transfers.length)throw new Error(JSON.stringify(receipt));
    return receipt;
  });
  for(const c of clients)await run('armor:'+c.options.username,async()=>{
    const brain=createMinecraftBrain({...base,client:c,worldId:'daily-acceptance',storage:{radius:32,maxStacks:54}});brains.push(brain);
    for(let i=0;i<7;i++)await brain.tick();
    const equipped=equipment(c);if(Object.values(equipped).some(n=>!n))throw new Error("Not all four parts of the armor are available and on: "+JSON.stringify(equipped));
    return {equipped,inventory:c.inventory.snapshot()};
  });
  const c=clients[0],start=floor(c.state.position);
  await run('diagonal-sprint',async()=>{
    const candidates=[[12,12],[-12,12],[12,-12],[-12,-12]].map(([x,z])=>({...start,x:start.x+x,z:start.z+z}));
    const goal=candidates.find(goal=>{const route=planRoute({start,goal,getBlock:p=>c.world.blockAt(p),range:0});return route.status==='planned'&&route.steps.every(s=>s.kind==='walk');});
    if(!goal)throw new Error("No known land area for the diagonal route.");
    let sprintTicks=0,airborneSprintTicks=0,diagonalTicks=0,maxYawStep=0,lastYaw=c.state.yaw;const initialCorrections=c.metrics.corrections;
    const sample=()=>{if(c.state.sprinting)sprintTicks++;if(c.state.sprinting&&!c.state.onGround)airborneSprintTicks++;if(Math.abs(c.control.x)>.1&&Math.abs(c.control.z)>.1)diagonalTicks++;maxYawStep=Math.max(maxYawStep,Math.abs(((c.state.yaw-lastYaw+540)%360)-180));lastYaw=c.state.yaw;};
    c.on('physics',sample);try{await c.execute({skill:'navigate',args:{...goal,range:0,bridge:false}},{signal:AbortSignal.timeout(30000)});}finally{c.off('physics',sample);}
    const evidence={start,goal,position:c.state.position,sprintTicks,airborneSprintTicks,diagonalTicks,maxYawStep,corrections:c.metrics.corrections-initialCorrections};
    if(!diagonalTicks)throw new Error("No diagonal traffic recorded.");return evidence;
  });
  await run('shared-destination-spacing',async()=>{
    const goal=floor(c.state.position),results=await Promise.allSettled(clients.slice(1).map(other=>other.execute({skill:'navigate',args:{...goal,range:2,bridge:false}},{signal:AbortSignal.timeout(45000)})));
    const positions=clients.map(c=>({...c.state.position})),separations=[];
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)separations.push(Math.hypot(positions[i].x-positions[j].x,positions[i].z-positions[j].z));
    const evidence={goal,positions,separations,results:results.map(r=>r.status==='fulfilled'?r.value:{error:r.reason.message})};
    if(results.some(r=>r.status==='rejected')||Math.min(...separations)<.65)throw new Error(JSON.stringify(evidence));return evidence;
  });
  await run('hunt-and-pickup',async()=>{
    const brain=createMinecraftBrain({...base,client:c,worldId:'daily-acceptance',equipment:true,loot:{},hunting:{targets:{leather:4},foodReserve:6,prepareWool:true}});brains.push(brain);
    const before=c.inventory.snapshot(),until=Date.now()+60000;let changed=false;
    while(Date.now()<until&&c.state.status==='ready'){
      await brain.tick();
      changed=Object.entries(c.inventory.snapshot()).some(([item,n])=>/wool|leather|beef|mutton|porkchop|chicken|rabbit/.test(item)&&n>(before[item]||0));
      if(changed)break;await delay(150);
    }
    const evidence={before,after:c.inventory.snapshot(),entities:c.observe().entities.filter(e=>['cow','sheep','pig','chicken'].includes(e.name))};
    if(!changed)throw new Error("No equipment confirmed for a minute.");return evidence;
  });
  await run('prepare-bed',async()=>{
    const candidates=clients.filter(agent=>agent.inventory.items().some(i=>i.name.endsWith('_bed')||i.name.endsWith('_wool')&&agent.inventory.count(i.name)>=3));
    if(!candidates.length)throw new Error("No ready bed or three blocks of wool of the same color.");
    const agent=candidates[0];const result=await agent.execute({skill:'prepareBed',args:{}},{signal:AbortSignal.timeout(45000)});
    return {name:agent.options.username,...result};
  });
  await run('night-sleep',async()=>{
    const beds=await c.world.findBlocks({classes:['#beds'],position:c.state.position,radius:32,count:8});
    if(!sleepTime(c.time.timeOfDay))throw new Error("It's day; The time of peace hasn't changed.");
    const brain=createMinecraftBrain({...base,client:c,worldId:'daily-acceptance',night:{}});brains.push(brain);
    let slept=false;c.on('sleep',()=>{slept=true;});
    const before=c.time.timeOfDay;
    for(let i=0;i<3&&!slept;i++)await brain.tick();
    if(!slept)throw new Error("The dream is not confirmed: beds "+beds.blocks.length+", wool "+JSON.stringify(Object.fromEntries(Object.entries(c.inventory.snapshot()).filter(([n])=>n.endsWith('_wool')))));
    return {before,after:c.time.timeOfDay,sleepConfirmed:slept,stillSleeping:Boolean(c.state.sleeping)};
  });
  report.status=report.phases.every(p=>p.status==='passed')?'passed':'incomplete';
}catch(error){report.status='failed';report.reason=error.message;}
finally{
  for(const brain of brains)await brain.stop();
  for(const c of clients)if(report.agents[c.options.username])report.agents[c.options.username].final=c.snapshot();
  await fleet.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/daily-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,reason:report.reason}));process.exitCode=report.status==='passed'?0:1;
}
