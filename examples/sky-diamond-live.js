import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createOMConnect,OMCONNECT} from '../omconnect/index.js';
import {createMinecraftBrain} from '../overmindmc.js';

// Only the goal and trial permissions are configured here. Resource dependency
// planning, tool selection, material procurement and elevated access live in the libraries.
const name=process.env.MC_NAME||'RowanSky',worldId=process.env.MC_WORLD||'local-sky-diamond';
const reportPath='data/sky-diamond-live.json',controlPath='data/sky-diamond-control.json';
const c=createOMConnect({username:name,host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',viewDistance:20,
  protection:{structures:process.env.MC_ALLOW_VILLAGE_MATERIALS!=='1'}});
let report={version:OMCONNECT.version,name,worldId,phase:'connecting',startedAt:new Date().toISOString(),actions:[],pillarSteps:[],warnings:[],sessions:0};
if(process.argv.includes('--resume')){report=JSON.parse(await readFile(reportPath,'utf8'));if(report.name!==name||report.worldId!==worldId)throw new Error('Resume requires the same agent and world ID.');}
report.sessions++;report.phase='connecting';let brain,current,ended=false,lastSave=0,lastStatus='';
const stop=new AbortController();
c.on('warning',e=>{report.warnings.push(e.message);console.log('WARNING',e.message);});
c.on('decodeFailure',e=>{void writeFile('data/sky-diamond-decode.json',JSON.stringify({...e,bytes:e.bytes.toString('base64')},null,2));});
c.on('pillarStep',e=>{report.pillarSteps.push(e);console.log('PILLAR',JSON.stringify(e));});
c.on('death',()=>{if(report.phase!=='connecting'){report.phase='failed';report.reason='Agent died.';void brain?.stop();}});
c.on('end',()=>{ended=true;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop.abort());
const save=async()=>{report.current={position:c.state.position,health:c.state.health,food:c.state.food,gameMode:c.state.gameMode,inventory:c.inventory.snapshot(),equipment:c.inventory.equipment(),plan:brain?.survival?.snapshot()??null,metrics:c.metrics};await writeFile(reportPath,JSON.stringify(report,null,2));};
await mkdir('data',{recursive:true});
try{
  await c.connect();if(c.state.status==='dead')await c.respawn();
  if(c.state.gameMode!=='survival')throw new Error('This trial requires Survival mode.');
  report.initial??=c.snapshot();
  if(!process.argv.includes('--resume')&&Object.values(report.initial.inventory).some(n=>n>0))throw new Error('A fresh trial requires an empty inventory; use a new MC_NAME.');
  await c.waitFor(()=>c.recipeBook.received,{event:'recipes',timeoutMs:10000});
  brain=createMinecraftBrain({client:c,worldId,storage:false,night:false,hunting:false,recovery:false,
    defense:{attackPlayers:false},survival:{targets:{'minecraft:diamond':1}},
    adapterOptions:{searchRadius:192,trackedBlocks:['#logs','#ores','#workstations','stone','cobblestone','deepslate','cobbled_deepslate']},
    config:{tickIntervalMs:100,actionTimeoutMs:30000,rules:[]}});
  brain.on('action:start',e=>{current=e.action;console.log('ACTION',JSON.stringify({action:current,reason:e.reason??e.description,plan:brain.survival.snapshot().plan}));});
  brain.on('action:finish',e=>{report.actions.push({...e,args:current?.args,position:{...c.state.position},inventory:c.inventory.snapshot()});if(report.actions.length>1500)report.actions.shift();console.log('RESULT',JSON.stringify({skill:e.skill,outcome:e.outcome,detail:e.detail}));});
  report.phase='running';await writeFile(controlPath,JSON.stringify({command:'run'}));await save();brain.start();
  console.log('CONNECTED',JSON.stringify({name,position:c.state.position,goal:{'minecraft:diamond':1},villageMaterialHarvesting:!c.protection.structures}));
  while(!stop.signal.aborted&&!ended){
    if(c.connectionAbort.signal.aborted){report.phase='failed';report.reason=c.connectionAbort.signal.reason?.message||'Connection action stream was aborted.';break;}
    let command='run';try{command=JSON.parse(await readFile(controlPath,'utf8')).command;}catch{}
    if(command==='stop')break;
    if(command==='pause'&&report.phase==='running'){await brain.stop();report.phase='paused';}
    if(command==='run'&&report.phase==='paused'){report.phase='running';brain.start();}
    if(report.phase==='running'&&c.inventory.count('diamond')>=1){
      await brain.stop();
      const crafted=report.actions.some(e=>e.skill==='craft'&&e.outcome==='success'&&String(e.args?.item).replace('minecraft:','')==='iron_pickaxe');
      const mined=report.actions.some(e=>e.skill==='dig'&&e.outcome==='success'&&/^(minecraft:)?(?:deepslate_)?diamond_ore$/.test(e.args?.block||''));
      report.phase=crafted&&mined&&report.pillarSteps.length?'passed':'incomplete';report.evidence={craftedIronPickaxe:crafted,minedDiamondOre:mined,pillarPlacements:report.pillarSteps.length,diamonds:c.inventory.count('diamond')};report.finishedAt=new Date().toISOString();console.log('TRIAL_RESULT',JSON.stringify({phase:report.phase,...report.evidence}));
    }
    if(Date.now()-lastSave>=1000){await save();lastSave=Date.now();const status=JSON.stringify({phase:report.phase,position:c.state.position,health:c.state.health,inventory:c.inventory.snapshot(),reason:brain.survival.snapshot().reason,elevatedAccess:brain.survival.snapshot().elevatedAccess});if(status!==lastStatus){console.log('STATUS',status);lastStatus=status;}}
    await delay(250,undefined,{signal:stop.signal}).catch(()=>{});
  }
}catch(e){report.phase='failed';report.reason=e.message;console.log('ERROR',e.message);}
finally{await brain?.stop();await save();await c.close();report.stoppedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2));console.log('STOPPED');}
