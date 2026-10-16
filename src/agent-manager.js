import { createFleet, createOMConnect } from '../omconnect/index.js';
import { createMinecraftBrain } from './minecraft-brain.js';
import {createTaskQueue,validateTasks} from './task-queue.js';
import {createMissionRecovery} from './mission-recovery.js';
import {createSwarmCoordinator} from './swarm-coordinator.js';
import {attachSwarmAgent} from './swarm-integration.js';
import {createTeamStorageAllocator} from './team-storage.js';
import {createAgentMemory} from './agent-memory.js';
import {createNeuralNavigator} from './neural-navigation.js';
import {createNeuralPlanner} from './neural-planning.js';
import {createSpatialMemory} from './spatial-memory.js';
import {createWorldAtlas,worldAtlasScope} from './world-atlas.js';
import {createCognitiveEngine} from './cognitive-engine.js';
import {createScenario} from './scenario.js';
import {createNavigationGoal} from './navigation-goal.js';
import {catalogFromMinecraftData} from './catalog.js';
import {createSurvivalReactor} from './survival-brain.js';
import {createDragonPolicy} from './dragon-brain.js';
import { runInteraction } from './interactions.js';
import { runTrade } from './trade.js';
import { equipmentTradeTargets } from './equipment-policy.js';
import {proposeTeamTransfer,teamSupplyTargets} from './cooperation.js';
import {createVisionSnapshot,createVisionVolume} from './vision.js';
import {parseSchematic,buildSchematic,findSchematicSite,buildSchematicPhysical} from './schematics.js';
import {createActionEvidenceMemory} from './action-evidence.js';
import {createNetherReactor} from './nether.js';

/** Application-level lifecycle, independent of the HTTP presentation layer. */
export function createAgentManager({ count = 3, names = ['Owen','Liam','Noah','Mason','Lucas','Ethan','James','Oliver','Henry','Logan','Alice','Blake','Charlie','Dylan','Ella','Finn','Grace','Ivy','Jack','Kai'].slice(0,count), connection = {}, worldId = 'local-survival', createClient = createOMConnect, createBrain = createMinecraftBrain, memoryDirectory, brainOptions = {},supplyTargets={}, recovery=false, cooperation=names.length>1 } = {}) {
  if (!brainOptions || typeof brainOptions !== 'object' || Array.isArray(brainOptions)) throw new Error("brainOptions: brain object.");
  if(brainOptions.storage!==undefined&&brainOptions.storage!==false&&(!brainOptions.storage||typeof brainOptions.storage!=='object'||Array.isArray(brainOptions.storage)))throw new Error('storage: options or false.');
  const actionEvidence=brainOptions.actionEvidence||createActionEvidenceMemory({worldId});
  if(actionEvidence.worldId!==worldId)throw new Error("Failure memory belongs to another world.");
  if(!supplyTargets||typeof supplyTargets!=='object'||Array.isArray(supplyTargets)||Object.entries(supplyTargets).some(([item,n])=>!/^minecraft:[a-z0-9_]+$/.test(item)||!Number.isInteger(n)||n<0||n>4096))throw new Error("supplyTargets: map minecraft:item and stock 0–4096.");
  if(cooperation!==false&&cooperation!==true&&(!cooperation||typeof cooperation!=='object'||Array.isArray(cooperation)))throw new Error('cooperation: boolean or lease options.');
  const swarm=cooperation===false?null:createSwarmCoordinator({worldId,members:names,capacity:cooperation.capacity,ttlMs:cooperation.ttlMs});
  const fleet = createFleet({count,names,connection,createClient}), entries = new Map(), log = [], blockedTrades=new Map();
  for(const [name,c]of fleet.agents){c.options||={};c.options.username??=name;}
  const storageAllocator=swarm?createTeamStorageAllocator({worldId,clients:()=>[...fleet.agents.values()],targets:c=>storageTargets(entries.get(c.options.username))}):null;
  const recoveries=new Map();
  if(recovery!==false&&(!recovery||typeof recovery!=='object'||Array.isArray(recovery)))throw new Error('recovery: false or recovery options.');
  let closed=false, closing;const memory=memoryDirectory?createAgentMemory(memoryDirectory,worldId,{maxBytes:8*1024*1024}):null;
  const retain=e=>{e.spatialMemory=e.brain?.spatial?.export()||e.spatialMemory;e.atlasMemory=e.brain?.atlas?.export({includeLandmarks:false})||e.atlasMemory;e.neuralMemory=e.brain?.neural?.export()||e.neuralMemory;e.cognitionMemory=e.brain?.cognition?.export()||e.cognitionMemory;e.cognitiveMemory=e.brain?.cognitive?.export()||e.cognitiveMemory;e.taskState=e.queue?.snapshot()||e.taskState;e.taskCheckpoint=e.queue?.checkpoint()||e.taskCheckpoint;};
  const saveTasks=async(name,e)=>{e.taskState=e.queue?.snapshot()||e.taskState;e.taskCheckpoint=e.queue?.checkpoint()||e.taskCheckpoint;if(memory)await memory.saveTasks(name,{tasks:e.tasks,taskState:e.taskState,taskCheckpoint:e.taskCheckpoint});};
  const save=async(name,e)=>{retain(e);await saveTasks(name,e);if(memory)await memory.save(name,{spatial:e.spatialMemory,atlas:e.atlasMemory,neural:e.neuralMemory,cognition:e.cognitionMemory,cognitive:e.cognitiveMemory,tasks:e.tasks,taskState:e.taskState,taskCheckpoint:e.taskCheckpoint,goal:e.goal,settings:e.settings});};
  const restore=async(name,e)=>{if(e.loaded)return;const base=await memory?.load(name),mission=await memory?.loadTasks(name),m=base||mission?{...base,...(mission?{tasks:mission.tasks,taskState:mission.taskState,taskCheckpoint:mission.taskCheckpoint}:{})}:null;if(m){const tasks=validateTasks(m.tasks||[],{skills:e.client.describe().skills});if(m.spatial)createSpatialMemory({worldId,memory:m.spatial});if(m.atlas)createWorldAtlas({scope:brainOptions.worldIntelligence?.scope||{...worldAtlasScope(e.client,worldId),...(e.client.state.status!=='ready'?{minecraftVersion:m.atlas.scope?.minecraftVersion}:{})},memory:m.atlas});e.spatialMemory=m.spatial;e.atlasMemory=m.atlas;if(m.neural)createNeuralNavigator({worldId,memory:m.neural});if(m.cognition)createNeuralPlanner({worldId,memory:m.cognition});if(m.cognitive)createCognitiveEngine({worldId,memory:m.cognitive});e.cognitiveMemory=m.cognitive;e.tasks=tasks;e.taskState=m.taskState;e.taskCheckpoint=m.taskCheckpoint;e.neuralMemory=m.neural;e.cognitionMemory=m.cognition;if(['wood','stone_tools','iron_pickaxe','diamond_set'].includes(m.goal))e.goal=m.goal;if(typeof m.settings?.humanizeMode==='boolean')e.settings.humanizeMode=m.settings.humanizeMode;if(Number.isInteger(m.settings?.viewDistance)&&m.settings.viewDistance>=2&&m.settings.viewDistance<=32)e.settings.viewDistance=m.settings.viewDistance;}e.client.options.humanizeMode=e.settings.humanizeMode;e.client.options.viewDistance=e.settings.viewDistance;e.loaded=true;};
  const releaseReservations=name=>{
    swarm?.releaseAgent(name);const peer=fleet.peers.get(name);
    for(const claim of peer.snapshot().claims)if(claim.from===name&&!claim.release)peer.release(claim.resource);
  };
  const note = (name,event,detail='') => {log.push({at:Date.now(),name,event,detail:String(detail).slice(0,500)});if(log.length>200)log.shift();};
  const wire = (name,client) => {
    client.options||={};client.options.username??=name;
    const old = entries.get(name), entry = {client,brain:null,busy:false,error:'',goal:old?.goal || 'diamond_set',survival:null,tasks:old?.tasks||[],taskState:old?.taskState||[],taskCheckpoint:old?.taskCheckpoint,queue:null,schematic:old?.schematic||null,schematicOrigin:old?.schematicOrigin||null,neuralMemory:old?.neuralMemory,cognitionMemory:old?.cognitionMemory,cognitiveMemory:old?.cognitiveMemory,spatialMemory:old?.spatialMemory,atlasMemory:old?.atlasMemory,settings:old?.settings||{humanizeMode:Boolean(client.options.humanizeMode),viewDistance:client.options.viewDistance||24},loaded:old?.loaded||false};
    client.options.humanizeMode=entry.settings.humanizeMode;client.options.viewDistance=entry.settings.viewDistance;
    old?.detachStorage?.();entry.detachStorage=storageAllocator?.attach(client);
    old?.detachSwarm?.();entry.detachSwarm=swarm?attachSwarmAgent(client,{coordinator:swarm,name,maxWaitMs:cooperation.maxWaitMs}):null;
    entry.runRequested=false;entry.intentVersion=0;
    entries.set(name,entry);client.managedNames=new Set(names.map(n=>n.toLowerCase()));
    for(const event of ['warning','fault'])client.on(event,e=>{entry.error=String(e.message);note(name,event,e.message);});
    client.on('action',e=>note(name,e.skill,`${e.outcome} ${e.detail}`));
    const interrupted=cause=>{if(entries.get(name)!==entry)return;void Promise.resolve(entry.brain?.stop()).then(()=>{if(entries.get(name)===entry)releaseReservations(name);}).catch(error=>note(name,'recovery-error',error.message));note(name,cause);void recoveries.get(name)?.request(cause);};
    client.on('death',()=>interrupted('death'));
    client.on('end',()=>interrupted('disconnected'));
    if(recovery!==false&&!recoveries.has(name))recoveries.set(name,createMissionRecovery({...recovery,recover:async({reason,signal})=>{
      let current=entries.get(name);await current.brain?.stop();signal.throwIfAborted();await save(name,current);signal.throwIfAborted();
      current.brain=null;current.queue=null;
      if(current.client.state.status==='disconnected')await execute(name,'connect',{},signal);
      signal.throwIfAborted();current=entries.get(name);
      if(current.client.state.health<=0||current.client.state.status==='dead')await current.client.respawn();
      signal.throwIfAborted();await execute(name,'start',{},signal);note(name,'recovered',reason);
    }}));
    return entry;
  };
  for(const [name,client]of fleet.agents)wire(name,client);
  const snapshot = () => ({worldId,cooperation:swarm?.snapshot()||null,storageAllocation:storageAllocator?.snapshot()||null,agents:[...entries].map(([name,e])=>({name,busy:e.busy,error:e.error,perception:e.brain?.perception?.snapshot()||null,combat:e.brain?.combatPolicy?.snapshot()||null,recovery:recoveries.get(name)?.snapshot()||null,goal:e.goal,settings:{...e.settings},attention:e.client.humanize?.last||null,schematic:e.schematic?{format:e.schematic.format,blockCount:e.schematic.blockCount,size:e.schematic.size,unsupportedStates:e.schematic.unsupportedStates,origin:e.schematicOrigin}:null,state:e.client.snapshot(),inventory:(e.client.dataLoaded===false?[]:e.client.inventory.items()).map(i=>({item:i.item,name:i.name,count:i.count,slot:i.slot})),brain:e.brain?.snapshot() || null,survival:e.brain?.survival?.snapshot() || null,skills:e.client.describe().skills,tasks:e.tasks,taskState:e.queue?.snapshot()||e.taskState,learning:e.brain?.neural?.snapshot()||null,cognition:e.brain?.cognition?.snapshot()||null,spatial:e.brain?.spatial?.snapshot()||null,atlas:e.brain?.atlas?.snapshot()||null,recipes:e.client.dataLoaded===false?null:e.client.recipeBook?.snapshot()||null})),log:[...log]});
  const importSchematic=(name,buffer,filename)=>{const e=entries.get(name);if(!e)throw new Error("Unknown agent.");const schematic=parseSchematic(buffer,{filename});e.schematic=schematic;e.schematicOrigin=null;note(name,'schematic',`${schematic.format}: ${schematic.blockCount} blocks`);return {format:schematic.format,blockCount:schematic.blockCount,size:schematic.size,unsupportedStates:schematic.unsupportedStates};};
  const execute = async(name,command,args={},cancellation,automatic=false) => {
    if(closed)throw new Error("Manager closed. Create a new instance.");
    let e=entries.get(name);if(!e)throw new Error("Unknown agent.");
    if(['pause','disconnect','tasks','goal'].includes(command))recoveries.get(name)?.pause();
    if(command==='pause'){e.managementAbort?.abort(new Error('Management paused by user.'));e.runRequested=false;e.intentVersion++;await e.brain?.pause();e.client.pending?.abort.abort(new Error("Stopped in the panel."));await e.client.pending?.promise.catch(()=>{});releaseReservations(name);return snapshot();}
    if(e.busy)throw new Error("Previous management still in place.");e.busy=true;e.error='';
    if(!automatic&&['disconnect','respawn','tasks','taskRetry','goal','action','give','trade','buildSchematic'].includes(command)){e.runRequested=false;e.intentVersion++;}
    try {
      await ready;cancellation?.throwIfAborted();
      if(closed)throw new Error("Manager closes.");
      await restore(name,e);
      if(command==='connect') {
        if(e.client.state.status==='disconnected') {
          if(e.client.connectedOnce){await e.brain?.stop();retain(e);await e.client.close();e=wire(name,createClient({...connection,username:name}));e.busy=true;fleet.agents.set(name,e.client);}
          await e.client.connect();note(name,'connected');
        }
      } else if(command==='disconnect'){await e.brain?.stop();await e.client.close();releaseReservations(name);}
      else if(command==='respawn'){await e.brain?.stop();await e.client.respawn();note(name,'respawn');}
      else if(command==='start'){
        if(e.client.state.status!=='ready')throw new Error("First, connect or re-enact the agent.");
        if(!e.brain){
          const catalog=e.tasks.length?catalogFromMinecraftData(e.client.registry,{recipeBook:e.client.recipeBook}):null;
          const resourceFactory=targets=>{
            const r=createSurvivalReactor({client:e.client,catalog,targets,priority:20,peer:fleet.peers.get(name),actionEvidence,spatial:e.brain?.spatial,explorationPlanner:e.brain?.computation}),react=r.react;
            r.react=o=>{e.resourceDemand={reactor:r,targets:{...targets}};return react(o);};return r;
          };
          e.queue=e.tasks.length?createTaskQueue({tasks:e.tasks,skills:e.client.describe().skills,resume:e.taskCheckpoint||e.taskState,checkpoint:memory?async()=>saveTasks(name,e):undefined,scenarioFactory:(scenario,memory)=>createScenario({scenario,memory,catalog,getBlock:p=>e.client.world.blockAt(p),explorationPlanner:e.brain?.computation,resourceFactory,
            netherFactory:(step,memory)=>createNetherReactor({client:e.client,catalog,targets:step.targets,exploreDistance:step.exploreDistance,memory,resourceFactory,explorationPlanner:e.brain?.computation}),
            navigationFactory:step=>createNavigationGoal({client:e.client,catalog,...step,resourceFactory}),dragonCombat:createDragonPolicy({client:e.client})})}):null;
          const modelOptions=(key,saved)=>brainOptions[key]===false?false:{...brainOptions[key],...(saved?{memory:saved}:{})};
          e.brain=createBrain({...brainOptions,storage:brainOptions.storage===false?false:{...(storageAllocator?{mode:'team'}:{}),...brainOptions.storage},actionEvidence,client:e.client,worldId,spatial:modelOptions('spatial',e.spatialMemory),worldIntelligence:modelOptions('worldIntelligence',e.atlasMemory),neural:modelOptions('neural',e.neuralMemory),cognition:modelOptions('cognition',e.cognitionMemory),cognitive:modelOptions('cognitive',e.cognitiveMemory),survival:e.queue?false:brainOptions.survival===false?false:{...brainOptions.survival,target:e.goal,peer:fleet.peers.get(name)},reactors:[...(e.queue?[e.queue.reactor]:[]),...(brainOptions.reactors||[])]});e.queue?.attach(e.brain);
        }
        cancellation?.throwIfAborted();recoveries.get(name)?.enable();e.runRequested=true;e.intentVersion++;e.brain.start();
      } else if(command==='settings'){
        if(typeof args.humanizeMode!=='boolean'||!Number.isInteger(args.viewDistance)||args.viewDistance<2||args.viewDistance>32)throw new Error("Settings: Humanize boolean and review 2–32 The cup.");
        e.settings={humanizeMode:args.humanizeMode,viewDistance:args.viewDistance};
        e.client.options.humanizeMode=args.humanizeMode;e.client.options.viewDistance=args.viewDistance;
        if(e.client.state.status==='ready'){
          e.client.world.maxChunks=args.viewDistance>16?2048:1024;
          e.client.write('settings',{locale:'ru_ru',viewDistance:args.viewDistance,chatFlags:0,chatColors:true,skinParts:127,mainHand:1,enableTextFiltering:false,enableServerListing:true});
        }
        await save(name,e);note(name,'settings',`Humanize ${args.humanizeMode?'on':'off'}, Overview ${args.viewDistance} chunks`);
      } else if(command==='buildSchematic'){
        if(!e.schematic)throw new Error("First, load the circuit over the panel.");
        if(e.client.state.status!=='ready')throw new Error("The agent should be in the world.");
        await e.brain?.pause();
        const selected=args.origin||e.schematicOrigin||findSchematicSite(e.client,e.schematic,{minDistance:16,maxDistance:128})?.origin;
        if(!selected)throw new Error("Free flat area not found in the cups received.");
        const origin={...selected};
        e.schematicOrigin=origin;
        const build=e.client.state.gameMode==='creative'?buildSchematicPhysical:buildSchematic;
        const result=await build(e.client,e.schematic,origin,{signal:AbortSignal.timeout(180000),maxActions:Math.min(32,Math.max(1,Number(args.maxActions)||16))});
        note(name,'buildSchematic',`${result.status}: ${result.actions} actions`);return {...result,origin};
      } else if(command==='tasks'){
        const tasks=validateTasks(args.tasks,{skills:e.client.describe().skills});
        await e.brain?.stop();retain(e);e.brain=null;e.queue=null;e.resourceDemand=null;e.tasks=tasks;e.taskState=[];e.taskCheckpoint=undefined;await save(name,e);note(name,'tasks',`Objectives: ${tasks.length}`);
      } else if(command==='taskRetry'){
        await e.brain?.pause();if(!e.queue)throw new Error("Start the line first.");e.queue.retry(args.id);await save(name,e);
      } else if(command==='goal') {
        if(!['wood','stone_tools','iron_pickaxe','diamond_set'].includes(args.target))throw new Error("Goal: wood, stone_tools, iron_pickaxe, diamond_set.");
        await e.brain?.stop();retain(e);e.brain=null;e.queue=null;e.tasks=[];e.taskState=[];e.taskCheckpoint=undefined;e.goal=args.target;await save(name,e);
      } else if(command==='action') {
        await e.brain?.pause();
        return await e.client.execute(args,{priority:500,signal:AbortSignal.timeout(60000)});
      } else if(command==='give'||command==='trade') {
        const other=entries.get(args.to);if(!other||other===e)throw new Error("Choose another recipient.");
        if(other.busy)throw new Error("The recipient is busy.");other.busy=true;
        if(!automatic){other.runRequested=false;other.intentVersion++;recoveries.get(args.to)?.pause();}
        const managementAbort=new AbortController(),signal=AbortSignal.any([managementAbort.signal,...(cancellation?[cancellation]:[])]);e.managementAbort=managementAbort;other.managementAbort=managementAbort;
        try{
          await e.brain?.pause();await other.brain?.pause();signal.throwIfAborted();
          const clients=[...entries.values()].map(e=>e.client);
          return command==='give'?await runInteraction({from:e.client,to:other.client,kind:'give',item:args.item,count:args.count??1,peers:fleet.peers,signal}):await runTrade({from:e.client,to:other.client,fromTargets:teamSupplyTargets(e.client,clients,targets(e)),toTargets:teamSupplyTargets(other.client,clients,targets(other)),peers:fleet.peers,signal});
        }finally{other.busy=false;if(e.managementAbort===managementAbort)e.managementAbort=null;if(other.managementAbort===managementAbort)other.managementAbort=null;}
      } else throw new Error("Unknown command command.");
      return snapshot();
    } catch(error){e.error=String(error.message);note(name,'error',e.error);throw error;}
    finally{e.busy=false;}
  };
  const targets=e=>{const s=e.brain?.survival?.snapshot()||e.resourceDemand?.reactor.snapshot();return equipmentTradeTargets(e.client,{...s?.targets,...Object.fromEntries((s?.plan||[]).map(p=>[p.item,p.required])),...(s?.stage?{[s.stage.includes(':')?s.stage:'minecraft:'+s.stage]:1}:{}),...supplyTargets});};
  const storageTargets=e=>e.resourceDemand?equipmentTradeTargets(e.client,{...e.resourceDemand.targets,...supplyTargets}):targets(e);
  let tradeTickRunning=false;
  const timer=setInterval(async()=>{
    if(closed||tradeTickRunning)return;tradeTickRunning=true;
    try{
    const available=[...entries].filter(([,e])=>!e.busy&&e.client.state.status==='ready'&&e.brain?.snapshot().running);
    for(const [name,a]of available)for(const [other,b]of available){
      const key=[name,other].sort().join('/');if(a===b||a.busy||b.busy||(blockedTrades.get(key)||0)>Date.now())continue;
      const p=a.client.state.position,q=b.client.state.position;if(!p||!q||Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>16)continue;
      const clients=available.map(([,e])=>e.client);
      const transfer=proposeTeamTransfer({clients:[a.client,b.client],targets:c=>teamSupplyTargets(c,clients,targets(c===a.client?a:b))});
      if(!transfer||transfer.from!==a.client)continue;
      const resume=[{name,entry:a,brain:a.brain,version:a.intentVersion},{name:other,entry:b,brain:b.brain,version:b.intentVersion}];
      try{const result=await execute(name,'trade',{to:other},undefined,true);note(name,'trade',`${other}: ${result.status}`);if(['partial','failed'].includes(result.status))blockedTrades.set(key,result.status==='partial'?Infinity:Date.now()+30000);}
      catch(error){note(name,'trade-error',error.message);blockedTrades.set(key,Date.now()+30000);}
      finally{if(!closed)for(const captured of resume){const e=captured.entry;if(entries.get(captured.name)===e&&e.runRequested&&e.intentVersion===captured.version&&e.brain===captured.brain&&e.client.state.status==='ready')e.brain?.start();}}
      return;
    }
    }catch(error){note('team','trade-error',error.message);}finally{tradeTickRunning=false;}
  },4000);timer.unref();
  const persistence=setInterval(()=>{if(!closed&&memory)for(const [name,e]of entries)if(e.loaded)void save(name,e).catch(error=>note(name,'memory-error',error.message));},15000);persistence.unref();
  const ready=Promise.all([...entries].map(async([name,e])=>{try{await restore(name,e);}catch(error){e.error=String(error.message);note(name,'memory-error',e.error);}}));
  const vision3d=(name,options)=>{
    const e=entries.get(name);if(!e)throw new Error('Unknown agent.');const waypoints=[];
    const collect=nodes=>{for(const node of nodes||[]){if(node.type==='navigate')waypoints.push({id:node.id,title:node.title||'Move',position:node.position});collect(node.children||node.then);collect(node.else);}};
    for(const task of e.tasks){if(task.type==='program')collect(task.program.nodes);else if(task.type==='scenario')collect(task.scenario.steps);else if(['navigate','creativeFly','goto'].includes(task.action?.skill))waypoints.push({id:task.id,title:task.title,position:task.action.args});}
    return createVisionVolume(e.client,{...options,waypoints});
  };
  const catalog=name=>{const e=entries.get(name);if(!e)throw new Error('Unknown agent.');if(e.client.dataLoaded===false)return {status:'waiting',items:[]};return {status:'ready',items:e.client.registry.itemsArray.slice(0,10000).map(item=>({id:'minecraft:'+item.name,name:item.displayName||item.name.replaceAll('_',' ')}))};};
  return {fleet,entries,snapshot,importSchematic,vision3d,catalog,vision(name,options){const e=entries.get(name);if(!e)throw new Error("Unknown agent.");return createVisionSnapshot(e.client,options);},execute,ready,close(){
    if(!closing){
      closed=true;clearInterval(timer);clearInterval(persistence);
      closing=(async()=>{
        await ready;
        const errors=[];
        await Promise.all([...recoveries.values()].map(r=>r.close()));
        for(const [name,e]of entries){
          e.managementAbort?.abort(new Error('Manager closed.'));
          try{await e.brain?.stop();}catch(error){errors.push(error);}
          try{if(e.loaded)await save(name,e);}catch(error){errors.push(error);}
        }
        try{await fleet.close();}catch(error){errors.push(error);}
        for(const e of entries.values()){e.detachStorage?.();e.detachSwarm?.();}swarm?.close();
        try{await memory?.flush();}catch(error){if(!errors.includes(error))errors.push(error);}
        if(errors.length)throw new AggregateError(errors,"Clients closed, but the work's work is wrong.");
      })();
    }
    return closing;
  }};
}
