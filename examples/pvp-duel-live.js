import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createOMConnect,OMCONNECT} from '../omconnect/index.js';
import {createCore,createCombatReactor,createEquipmentReactor,createLootReactor} from '../overmindmc.js';
import {createOMAdapter} from '../adapters/omconnect.js';

// Match setup and recording only. Fighting, equipment and pickup use library policies.
const name=process.env.MC_NAME||'RowanDuel',opponent=process.env.MC_OPPONENT||'y9kudo';
const client=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',auth:'offline',username:name,viewDistance:12});
const stop=new AbortController(),reportPath='data/pvp-duel-live.json',controlPath='data/pvp-duel-control.json';
const report={version:OMCONNECT.version,name,opponent,phase:'connecting',startedAt:new Date().toISOString(),sentAttacks:0,confirmedOutgoingHits:0,confirmedArrowHits:0,confirmedShieldBlocks:0,confirmedIncomingHits:0,shotsConfirmed:0,shotsCancelled:0,weaponsUsed:{},healthLost:0,errors:[],events:[],motion:[]};
let core,finished=false,lastHealth=null,lastIncoming=null,lastStatus='',lastSave=0;
let motionTimer;
const ownArrows=new Set();
const event=(kind,data={})=>{report.events.push({...data,at:new Date().toISOString(),kind});if(report.events.length>2000)report.events.shift();};
const target=()=>[...client.entities.values()].find(e=>e.kind==='player'&&e.username?.toLowerCase()===opponent.toLowerCase());
const finish=reason=>{if(finished)return;finished=true;report.phase='finished';report.result=reason;report.finishedAt=new Date().toISOString();event('finished',{reason});void core?.stop().catch(e=>event('stop-error',{message:e.message}));};
const gear=()=>Object.fromEntries(Object.entries(client.inventory.equipment()).map(([slot,item])=>[slot,item?.name??null]));
const ready=()=>client.state.health>=18&&Object.entries({head:'diamond_helmet',chest:'diamond_chestplate',legs:'diamond_leggings',feet:'diamond_boots'}).every(([slot,item])=>gear()[slot]===item)&&(client.inventory.count('diamond_sword')>0||client.inventory.count('diamond_axe')>0);
const snapshot=()=>({position:client.state.position,health:client.state.health,food:client.state.food,equipment:gear(),inventory:client.inventory.snapshot(),held:client.inventory.held()?.name??null,shield:client.inventory.slots[45]?.name??null,target:target()?{id:target().id,position:target().position,health:target().metadata?.health??null}:null,tactic:client.combatDebug??null,aim:client.aimDebug??null,metrics:client.metrics});
const save=async()=>{report.current=snapshot();await writeFile(reportPath,JSON.stringify(report,null,2));};
client.on('warning',e=>{report.errors.push(String(e.message).slice(0,300));if(report.errors.length>100)report.errors.shift();event('warning',{message:e.message});});
client.on('damage',e=>{
  const other=target();
  if(e.entityId===String(client.state.entityId)){report.confirmedIncomingHits++;lastIncoming=performance.now();event('damage-received',{sourceId:e.sourceId,health:client.state.health});}
  if(other&&e.entityId===String(other.id)&&e.sourceId===String(client.state.entityId)){report.confirmedOutgoingHits++;const arrow=e.directId!==null&&ownArrows.has(e.directId);if(arrow)report.confirmedArrowHits++;event('damage-inflicted',{entityId:e.entityId,directId:e.directId,arrow,observedHealth:other.metadata?.health??null});}
});
client.on('entity',e=>{if(['arrow','spectral_arrow'].includes(e.name)&&e.ownerId===client.state.entityId){ownArrows.add(String(e.id));if(ownArrows.size>256)ownArrows.delete(ownArrows.values().next().value);}});
client.on('shotReleased',e=>event('shot-released',e));
client.on('shieldBlock',e=>{report.confirmedShieldBlocks++;event('shield-block',e);});
client.on('health',e=>{if(lastHealth!==null)report.healthLost+=Math.max(0,lastHealth-e.health);lastHealth=e.health;event('health',{health:e.health,food:e.food});});
client.on('attackSent',e=>{report.sentAttacks++;report.weaponsUsed[e.weapon]=(report.weaponsUsed[e.weapon]||0)+1;event('attack-sent',{...e,afterIncomingMs:lastIncoming===null?null:performance.now()-lastIncoming});lastIncoming=null;});
client.on('entityDead',e=>{if(e&&e.id===target()?.id)finish('opponent-died');});
client.on('death',()=>{if(['armed','dueling'].includes(report.phase))finish('agent-died');else event('death-before-armed');});
client.on('kicked',reason=>{event('kicked',{reason});stop.abort(new Error('Disconnected by server.'));});
client.on('end',()=>stop.abort(new Error('Connection ended.')));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop.abort(new Error('Duel process stopped.')));

await mkdir('data',{recursive:true});
await writeFile(controlPath,JSON.stringify({command:'run'}));
try {
  await client.connect();
  if(client.state.status==='dead')await client.respawn();
  const adapter=createOMAdapter(client,{searchRadius:24,trackedBlocks:['crafting_table']});
  const execute=adapter.execute.bind(adapter);
  adapter.execute=async(action,context)=>{const result=await execute(action,context);if(action.skill==='shoot'){if(result.shotServerConfirmed){report.shotsConfirmed++;const weapon=action.args.weapon||'bow';report.weaponsUsed[weapon]=(report.weaponsUsed[weapon]||0)+1;}if(result.shotCancelled)report.shotsCancelled++;event('ranged-action',{...result});}return result;};
  const combat=createCombatReactor({attackPlayers:true,retaliationHits:2,retaliationWindowMs:10000,retreatHealth:8,pathRetreat:false,maxChaseDistance:16});
  const equipment=createEquipmentReactor(),loot=createLootReactor({radius:6});
  const react=combat.react.bind(combat);
  combat.react=o=>{
    if(finished||!['armed','dueling'].includes(report.phase))return {action:null,reason:'Waiting for duel equipment.'};
    const response=react({...o,entities:(o.entities||[]).filter(e=>e.kind==='player'&&e.username?.toLowerCase()===opponent.toLowerCase())});
    if(response.action)report.phase='dueling';return response;
  };
  const pickup=loot.react.bind(loot);loot.react=o=>['preparing','armed'].includes(report.phase)?pickup(o):{action:null,reason:'No item collection during a duel.'};
  core=createCore({config:{schemaVersion:4,name,worldId:'arthas-beta1-duel',tickIntervalMs:50,actionTimeoutMs:15000,rules:[]},adapter,reactors:[combat,equipment,loot]});
  combat.attach(core);loot.attach(core);
  core.on('action:finish',e=>{event('action',{skill:e.skill,outcome:e.outcome,detail:e.detail});if(e.outcome==='failure')console.log('ACTION_FAILED',e.skill,e.detail);});
  report.phase='preparing';event('connected',{position:client.state.position});await save();
  motionTimer=setInterval(()=>{if(finished||!['armed','dueling'].includes(report.phase))return;const other=target();report.motion.push({at:new Date().toISOString(),self:{position:{...client.state.position},yaw:client.state.yaw,pitch:client.state.pitch},target:other?{position:{...other.position},yaw:other.yaw,onGround:other.onGround,motion:client.entityMotion.sample(other)}:null,aim:client.aimDebug??null,tactic:client.combatDebug??null});if(report.motion.length>600)report.motion.shift();},100);
  console.log('CONNECTED',JSON.stringify({name,position:client.state.position,opponent,report:reportPath,control:controlPath}));
  while(!stop.signal.aborted&&client.state.status!=='disconnected'){
    let command='run';try{command=JSON.parse(await readFile(controlPath,'utf8')).command;}catch{}
    if(command==='stop')break;
    if(command==='pause'&&!finished){report.phase='paused';client.attackers.clear();client.stopMovement();}
    if(command==='run'&&report.phase==='paused'){report.phase='preparing';client.attackers.clear();}
    if(!finished&&report.phase==='preparing'&&ready()){client.attackers.clear();report.phase='armed';event('armed');console.log('READY_FOR_DUEL',JSON.stringify({name,position:client.state.position,equipment:gear(),opponent,start:'Two fresh hits within ten seconds'}));}
    if(!finished&&report.phase!=='paused')await core.tick().catch(e=>{if(!stop.signal.aborted)event('tick-error',{message:e.message});});
    if(Date.now()-lastSave>=1000){await save();lastSave=Date.now();const status=JSON.stringify({phase:report.phase,health:client.state.health,equipment:gear(),inventory:client.inventory.snapshot(),position:client.state.position,attacks:report.sentAttacks,outgoingHits:report.confirmedOutgoingHits,incomingHits:report.confirmedIncomingHits,tactic:client.combatDebug?.mode});if(status!==lastStatus){console.log('STATUS',status);lastStatus=status;}}
    await delay(50,undefined,{signal:stop.signal}).catch(()=>{});
  }
} catch(error){report.error=String(error.message);event('process-error',{message:error.message});console.log('ERROR',error.message);}
finally {
  clearInterval(motionTimer);
  await core?.stop();await save();await client.close();
  if(!finished)report.phase='stopped';report.stoppedAt=new Date().toISOString();await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log('STOPPED',JSON.stringify({result:report.result,reason:report.error,report:reportPath}));
}
