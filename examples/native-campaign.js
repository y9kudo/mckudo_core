/** Real-server acceptance test. Decisions remain inside createMinecraftBrain. */
import {createFleet} from '../kudoconnect/index.js';
import {createMinecraftBrain,diamondSetTargets,runInteraction} from '../mckudo_core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const names=(process.env.MC_NAMES||'Owen,Liam,Noah').split(',');
const minutes=Number(process.env.MC_TEST_MINUTES||10);
if(names.length!==3||!Number.isFinite(minutes)||minutes<1||minutes>120)throw new Error('Нужны три имени и MC_TEST_MINUTES 1–120.');
const report={startedAt:new Date().toISOString(),server:'127.0.0.1:25565',status:'running',fromZero:true,goalAchieved:false,phases:[],agents:{}};
const fleet=createFleet({count:3,names}),clients=[...fleet.agents.values()],brains=[],controller=new AbortController();
let saveQueue=Promise.resolve();
const save=()=>saveQueue=saveQueue.then(()=>writeFile('data/native-campaign.json',JSON.stringify(report,null,2)));
const phase=(name,status,evidence)=>{const value={at:new Date().toISOString(),name,status,evidence};report.phases.push(value);console.log(JSON.stringify(value));return value;};
process.once('SIGINT',()=>controller.abort(new Error('Остановлено пользователем.')));
await mkdir('data',{recursive:true});
try{
  for(const c of clients){
    const r=report.agents[c.options.username]={warnings:[],actions:[],milestones:[],metrics:{sprintTicks:0,airborneSprintTicks:0,maxYawStep:0}};let lastYaw;
    c.on('warning',e=>{r.warnings.push(e.message);console.log(c.options.username,e.message);});
    c.on('physics',()=>{if(c.state.sprinting)r.metrics.sprintTicks++;if(c.state.sprinting&&!c.state.onGround)r.metrics.airborneSprintTicks++;if(lastYaw!==undefined)r.metrics.maxYawStep=Math.max(r.metrics.maxYawStep,Math.abs(((c.state.yaw-lastYaw+540)%360)-180));lastYaw=c.state.yaw;});
    const p=c.connect();c.client.on('declare_recipes',p=>r.recipeCount=p.recipes.length);await p;
    if(c.state.status==='dead')await c.respawn();
    r.initial=c.snapshot();report.fromZero&&=Object.keys(r.initial.inventory).length===0;
    phase('connect:'+c.options.username,'passed',{position:c.state.position,health:c.state.health,inventory:r.initial.inventory,recipes:r.recipeCount});
  }
  await delay(1000,undefined,{signal:controller.signal});
  try{const meet=await runInteraction({from:clients[0],to:clients[1],kind:'meet',timeoutMs:20000,signal:controller.signal});
    phase('mutual-gaze',meet.status==='completed'?'passed':'failed',meet);
  }catch(error){phase('mutual-gaze','blocked',{reason:error.message});}
  for(const c of clients){
    const resources={};for(const group of ['#logs','#ores','#workstations'])resources[group]=await c.world.findBlocks({classes:[group],position:c.state.position,radius:128,count:64,signal:controller.signal});
    report.agents[c.options.username].resources=resources;
    phase('resource-classes:'+c.options.username,resources['#logs'].blocks.length?'passed':'blocked',{nearest:resources['#logs'].blocks[0],oreKinds:[...new Set(resources['#ores'].blocks.map(b=>b.name))],truncated:Object.values(resources).some(r=>r.truncated)});
    const brain=createMinecraftBrain({client:c,worldId:'local-1.21.1-campaign',storage:false,config:{actionTimeoutMs:60000},survival:{target:'diamond_set',peer:fleet.peers.get(c.options.username)}});brains.push(brain);
    brain.on('action:start',e=>{report.agents[c.options.username].currentAction=e.action;});
    brain.on('action:finish',e=>{const r=report.agents[c.options.username];r.actions.push(e);if(r.actions.length>2000)r.actions.shift();console.log(JSON.stringify({name:c.options.username,result:e}));void save();});
  }
  const deadline=Date.now()+minutes*60000;
  await Promise.all(clients.map(async(c,i)=>{
    const r=report.agents[c.options.username],brain=brains[i];
    while(Date.now()<deadline&&!controller.signal.aborted&&c.state.status==='ready'){
      await brain.tick();r.final=c.snapshot();r.brain=brain.survival.snapshot();
      for(const item of ['crafting_table','wooden_pickaxe','stone_pickaxe','furnace','iron_ingot','iron_pickaxe',...Object.keys(diamondSetTargets()).map(n=>n.slice(10))])if(c.inventory.count(item)>0&&!r.milestones.includes(item)){r.milestones.push(item);phase('inventory:'+c.options.username+':'+item,'passed',{count:c.inventory.count(item)});}
      if(Object.entries(diamondSetTargets()).every(([item,n])=>c.inventory.ownedCount(item)>=n)&&['head','chest','legs','feet'].every(slot=>c.inventory.equipment()[slot]?.name.startsWith('diamond_'))){r.goalAchieved=true;break;}
      await delay(100,undefined,{signal:controller.signal});
    }
  }));
  report.goalAchieved=Object.values(report.agents).every(r=>r.goalAchieved);
  report.status=report.goalAchieved?'passed':'incomplete';
}catch(error){report.status='failed';report.reason=error.message;}
finally{
  for(const brain of brains)await brain.stop();
  for(const c of clients){const r=report.agents[c.options.username];if(r)r.final=c.snapshot();await c.close();}
  await fleet.close();
  report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,goalAchieved:report.goalAchieved,fromZero:report.fromZero,reason:report.reason}));process.exitCode=report.status==='passed'?0:1;
}
