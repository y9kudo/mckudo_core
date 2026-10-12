import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createMinecraftBrain,MCKUDO} from '../../mckudo_core.js';
import {createKudoConnect} from '../../kudoconnect/index.js';
import {diamondEvidence} from './race-metrics.js';

// Post-race diagnostic of the working build. It is never entered into the
// historical ranking, including when it resumes one contender's inventory.
const username=process.env.MC_NAME||'RowanFix07';
const minutes=Number(process.env.MC_TEST_MINUTES||3);
if(!/^[A-Za-z0-9_]{1,16}$/.test(username)||!Number.isFinite(minutes)||minutes<.5||minutes>15)throw new Error('MC_NAME: 1–16 English characters; MC_TEST_MINUTES: 0.5–15.');
const host=process.env.MC_HOST||'127.0.0.1',port=Number(process.env.MC_PORT||25565);
let previous;
if(process.env.MC_PROBE_PREVIOUS_REPORT){
  const report=JSON.parse(await fs.readFile(process.env.MC_PROBE_PREVIOUS_REPORT,'utf8'));
  previous=Object.values(report.agents||{}).find(a=>a.name===username);
  if(!report.finishedAt||!previous?.processClosed||!(previous.state?.health>0)||report.server?.host!==host||report.server?.port!==port)throw new Error('Previous race must have finished on this server and closed this living contender.');
}
const client=createKudoConnect({host,port,username,version:'1.21.1',auth:'offline',viewDistance:8});
const report={kind:'post-race-working-build-probe',historicalRanking:false,runtimeVersion:MCKUDO.version,username,createdAt:new Date().toISOString(),previousVersion:previous?.version??null,status:'connecting',actions:{},events:[],mined:[],pickups:[],warnings:[],inventorySamples:[]};
report.sourceSHA256=Object.fromEntries(await Promise.all(['src/survival-brain.js','packages/kudoconnect/src/collection.js','packages/kudoconnect/src/equipment.js','packages/kudoconnect/src/actions.js'].map(async file=>[file,createHash('sha256').update(await fs.readFile(new URL('../../'+file,import.meta.url))).digest('hex')])));
let core,current,startedAt,abortTimer;const drops=new Map();
const controller=new AbortController(),signal=controller.signal;
const sample=()=>({at:Date.now(),position:{...client.state.position},health:client.state.health,inventory:client.inventory.snapshot()});
const bounded=(list,event,max=3000)=>{list.push(event);if(list.length>max)list.shift();};
client.on('warning',e=>bounded(report.warnings,String(e.message).slice(0,250),100));
client.on('drop',e=>{drops.set(String(e.id),{item:e.item?.name,position:{...e.position}});if(drops.size>4096)drops.delete(drops.keys().next().value);});
client.on('collect',e=>{if(e.own)bounded(report.pickups,{at:Date.now(),own:true,...drops.get(String(e.id))});});
const stop=reason=>{if(!signal.aborted){report.stopReason=reason;controller.abort(new Error(reason));void core?.stop();}};
process.once('SIGINT',()=>stop('user-interrupt'));process.once('SIGTERM',()=>stop('user-interrupt'));
try{
  await client.connect();await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:12000});
  if(client.state.gameMode!==0&&client.state.gameMode!=='survival')throw new Error('Probe requires survival mode; observed '+client.state.gameMode);
  report.initial=sample();report.fromEmptyInventory=Object.keys(report.initial.inventory).length===0;
  if(!previous&&!report.fromEmptyInventory)throw new Error('Use a fresh name or explicitly supply the finished previous report.');
  startedAt=report.startedAt=Date.now();report.status='running';
  core=createMinecraftBrain({client,worldId:'race-fix-probe-'+startedAt,config:{tickIntervalMs:200,actionTimeoutMs:20000},storage:false,night:false,hunting:false,defense:{attackPlayers:false},survival:{targets:{diamond:1}}});
  core.on('action:start',e=>{current=e.action;bounded(report.events,{at:Date.now(),phase:'start',action:e.action,position:{...client.state.position}});});
  core.on('action:finish',e=>{
    const action=current;current=null;
    const id=(action?.skill||e.skill)+'/'+e.outcome;report.actions[id]=(report.actions[id]||0)+1;
    bounded(report.events,{at:Date.now(),phase:'finish',action,result:e,position:{...client.state.position}});
    if(action?.skill==='dig'&&e.outcome==='success')bounded(report.mined,{at:Date.now(),block:(action.args.block||'').replace(/^minecraft:/,''),position:{x:action.args.x,y:action.args.y,z:action.args.z}});
  });
  abortTimer=setTimeout(()=>stop('time-limit'),minutes*60000);
  let nextSample=0;
  while(!signal.aborted&&client.state.status==='ready'&&client.state.health>0){
    await core.tick();
    const now=Date.now();report.diamondEvidence=diamondEvidence({startedAt,now,inventory:client.inventory.snapshot(),mined:report.mined,pickups:report.pickups});
    if(now>=nextSample){const s=sample();bounded(report.inventorySamples,s,1000);console.log(JSON.stringify({seconds:Math.round((now-startedAt)/1000),...s,reason:core.survival.snapshot().reason,actions:report.actions}));nextSample=now+10000;}
    if(report.diamondEvidence)break;
    await delay(200,undefined,{signal});
  }
  report.status=report.diamondEvidence?'diamond-confirmed':client.state.health<=0?'dead':signal.aborted?'time-limit':'disconnected';
}catch(error){report.status=signal.aborted?(report.stopReason==='time-limit'?'time-limit':'stopped'):'failed';report.reason=error.message;if(!signal.aborted)process.exitCode=1;}
finally{
  clearTimeout(abortTimer);report.final=sample();report.survival=core?.survival.snapshot();
  if(client.state.position){
    const p=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(client.state.position[k])]));report.localTerrain=[];
    for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++)for(let dy=-3;dy<=5;dy++){
      const position={x:p.x+dx,y:p.y+dy,z:p.z+dz},b=client.world.blockAt(position);
      report.localTerrain.push({position,block:b?{name:b.name,stateId:b.stateId,boundingBox:b.boundingBox,shapes:b.shapes,hardness:b.hardness,diggable:b.diggable,material:b.material,harvestTools:b.harvestTools}:null});
    }
  }
  try{await core?.stop();}catch(error){report.warnings.push('Brain cleanup: '+error.message);}
  try{await client.close();}catch(error){report.warnings.push('Client cleanup: '+error.message);process.exitCode=1;}
  report.closed=client.state.status==='disconnected';report.finishedAt=new Date().toISOString();
  await fs.mkdir('data',{recursive:true});const file='data/race-fix-probe-'+Date.now()+'.json';await fs.writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,closed:report.closed,actions:report.actions,output:file}));
}
