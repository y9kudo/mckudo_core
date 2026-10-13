import { createFleet, createKudoConnect } from '../kudoconnect/index.js';
import { createMinecraftBrain } from './minecraft-brain.js';
import {createTaskQueue,validateTasks} from './task-queue.js';
import {createAgentMemory} from './agent-memory.js';
import {createNeuralNavigator} from './neural-navigation.js';
import {createNeuralPlanner} from './neural-planning.js';
import {createSpatialMemory} from './spatial-memory.js';
import {createScenario} from './scenario.js';
import {createNavigationGoal} from './navigation-goal.js';
import {catalogFromMinecraftData} from './catalog.js';
import {createSurvivalReactor} from './survival-brain.js';
import {createDragonPolicy} from './dragon-brain.js';
import { runInteraction } from './interactions.js';
import { runTrade } from './trade.js';
import { equipmentTradeTargets } from './equipment-policy.js';
import {proposeTeamTransfer,teamSupplyTargets} from './cooperation.js';
import {createVisionSnapshot} from './vision.js';
import {parseSchematic,buildSchematic,findSchematicSite,buildSchematicPhysical} from './schematics.js';
import {createActionEvidenceMemory} from './action-evidence.js';

/** Application-level lifecycle, independent of the HTTP presentation layer. */
export function createAgentManager({ count = 3, names = ['Owen','Liam','Noah','Mason','Lucas','Ethan','James','Oliver','Henry','Logan','Alice','Blake','Charlie','Dylan','Ella','Finn','Grace','Ivy','Jack','Kai'].slice(0,count), connection = {}, worldId = 'local-survival', createClient = createKudoConnect, createBrain = createMinecraftBrain, memoryDirectory, brainOptions = {},supplyTargets={} } = {}) {
  if (!brainOptions || typeof brainOptions !== 'object' || Array.isArray(brainOptions)) throw new Error('brainOptions: объект параметров мозга.');
  const actionEvidence=brainOptions.actionEvidence||createActionEvidenceMemory({worldId});
  if(actionEvidence.worldId!==worldId)throw new Error('Память отказов принадлежит другому миру.');
  if(!supplyTargets||typeof supplyTargets!=='object'||Array.isArray(supplyTargets)||Object.entries(supplyTargets).some(([item,n])=>!/^minecraft:[a-z0-9_]+$/.test(item)||!Number.isInteger(n)||n<0||n>4096))throw new Error('supplyTargets: карта minecraft:предмет и запас 0–4096.');
  const fleet = createFleet({count,names,connection,createClient}), entries = new Map(), log = [], blockedTrades=new Map();
  let closed=false, closing;const memory=memoryDirectory?createAgentMemory(memoryDirectory,worldId):null;
  const retain=e=>{e.spatialMemory=e.brain?.spatial?.export()||e.spatialMemory;e.neuralMemory=e.brain?.neural?.export()||e.neuralMemory;e.cognitionMemory=e.brain?.cognition?.export()||e.cognitionMemory;e.taskState=e.queue?.snapshot()||e.taskState;};
  const save=async(name,e)=>{retain(e);if(memory)await memory.save(name,{spatial:e.spatialMemory,neural:e.neuralMemory,cognition:e.cognitionMemory,tasks:e.tasks,taskState:e.taskState,goal:e.goal,settings:e.settings});};
  const restore=async(name,e)=>{if(e.loaded)return;const m=await memory?.load(name);if(m){const tasks=validateTasks(m.tasks||[],{skills:e.client.describe().skills});if(m.spatial)createSpatialMemory({worldId,memory:m.spatial});e.spatialMemory=m.spatial;if(m.neural)createNeuralNavigator({worldId,memory:m.neural});if(m.cognition)createNeuralPlanner({worldId,memory:m.cognition});e.tasks=tasks;e.taskState=m.taskState;e.neuralMemory=m.neural;e.cognitionMemory=m.cognition;if(['wood','stone_tools','iron_pickaxe','diamond_set'].includes(m.goal))e.goal=m.goal;if(typeof m.settings?.humanizeMode==='boolean')e.settings.humanizeMode=m.settings.humanizeMode;if(Number.isInteger(m.settings?.viewDistance)&&m.settings.viewDistance>=2&&m.settings.viewDistance<=32)e.settings.viewDistance=m.settings.viewDistance;}e.client.options.humanizeMode=e.settings.humanizeMode;e.client.options.viewDistance=e.settings.viewDistance;e.loaded=true;};
  const note = (name,event,detail='') => {log.push({at:Date.now(),name,event,detail:String(detail).slice(0,500)});if(log.length>200)log.shift();};
  const wire = (name,client) => {
    client.options||={};
    const old = entries.get(name), entry = {client,brain:null,busy:false,error:'',goal:old?.goal || 'diamond_set',survival:null,tasks:old?.tasks||[],taskState:old?.taskState||[],queue:null,schematic:old?.schematic||null,schematicOrigin:old?.schematicOrigin||null,neuralMemory:old?.neuralMemory,cognitionMemory:old?.cognitionMemory,spatialMemory:old?.spatialMemory,settings:old?.settings||{humanizeMode:Boolean(client.options.humanizeMode),viewDistance:client.options.viewDistance||24},loaded:old?.loaded||false};
    client.options.humanizeMode=entry.settings.humanizeMode;client.options.viewDistance=entry.settings.viewDistance;
    entries.set(name,entry);client.managedNames=new Set(names.map(n=>n.toLowerCase()));
    for(const event of ['warning','fault'])client.on(event,e=>{entry.error=String(e.message);note(name,event,e.message);});
    client.on('action',e=>note(name,e.skill,`${e.outcome} ${e.detail}`));
    client.on('death',()=>{void entry.brain?.stop();note(name,'death');});
    client.on('end',()=>{void entry.brain?.stop();note(name,'disconnected');});
    return entry;
  };
  for(const [name,client]of fleet.agents)wire(name,client);
  const snapshot = () => ({worldId,agents:[...entries].map(([name,e])=>({name,busy:e.busy,error:e.error,goal:e.goal,settings:{...e.settings},attention:e.client.humanize?.last||null,schematic:e.schematic?{format:e.schematic.format,blockCount:e.schematic.blockCount,size:e.schematic.size,unsupportedStates:e.schematic.unsupportedStates,origin:e.schematicOrigin}:null,state:e.client.snapshot(),inventory:(e.client.dataLoaded===false?[]:e.client.inventory.items()).map(i=>({item:i.item,name:i.name,count:i.count,slot:i.slot})),brain:e.brain?.snapshot() || null,survival:e.brain?.survival?.snapshot() || null,skills:e.client.describe().skills,tasks:e.tasks,taskState:e.queue?.snapshot()||e.taskState,learning:e.brain?.neural?.snapshot()||null,cognition:e.brain?.cognition?.snapshot()||null,spatial:e.brain?.spatial?.snapshot()||null,recipes:e.client.dataLoaded===false?null:e.client.recipeBook?.snapshot()||null})),log:[...log]});
  const importSchematic=(name,buffer,filename)=>{const e=entries.get(name);if(!e)throw new Error('Неизвестный агент.');const schematic=parseSchematic(buffer,{filename});e.schematic=schematic;e.schematicOrigin=null;note(name,'schematic',`${schematic.format}: ${schematic.blockCount} блоков`);return {format:schematic.format,blockCount:schematic.blockCount,size:schematic.size,unsupportedStates:schematic.unsupportedStates};};
  const execute = async(name,command,args={}) => {
    if(closed)throw new Error('Менеджер закрыт. Создай новый экземпляр.');
    let e=entries.get(name);if(!e)throw new Error('Неизвестный агент.');
    if(command==='pause'){await e.brain?.pause();e.client.pending?.abort.abort(new Error('Остановлено в панели.'));await e.client.pending?.promise.catch(()=>{});return snapshot();}
    if(e.busy)throw new Error('Предыдущее управление ещё выполняется.');e.busy=true;e.error='';
    try {
      await ready;
      if(closed)throw new Error('Менеджер закрывается.');
      await restore(name,e);
      if(command==='connect') {
        if(e.client.state.status==='disconnected') {
          if(e.client.connectedOnce){await e.brain?.stop();retain(e);await e.client.close();e=wire(name,createClient({...connection,username:name}));e.busy=true;fleet.agents.set(name,e.client);}
          await e.client.connect();note(name,'connected');
        }
      } else if(command==='disconnect'){await e.brain?.stop();await e.client.close();}
      else if(command==='respawn'){await e.brain?.stop();await e.client.respawn();note(name,'respawn');}
      else if(command==='start'){
        if(e.client.state.status!=='ready')throw new Error('Сначала подключи или возроди агента.');
        if(!e.brain){
          const catalog=e.tasks.length?catalogFromMinecraftData(e.client.registry,{recipeBook:e.client.recipeBook}):null;
          const resourceFactory=targets=>createSurvivalReactor({client:e.client,catalog,targets,priority:20,actionEvidence,spatial:e.brain?.spatial,explorationPlanner:e.brain?.computation});
          e.queue=e.tasks.length?createTaskQueue({tasks:e.tasks,skills:e.client.describe().skills,resume:e.taskState,scenarioFactory:scenario=>createScenario({scenario,catalog,getBlock:p=>e.client.world.blockAt(p),explorationPlanner:e.brain?.computation,resourceFactory,
            navigationFactory:step=>createNavigationGoal({client:e.client,catalog,...step,resourceFactory}),dragonCombat:createDragonPolicy({client:e.client})})}):null;
          const modelOptions=(key,saved)=>brainOptions[key]===false?false:{...brainOptions[key],...(saved?{memory:saved}:{})};
          e.brain=createBrain({...brainOptions,actionEvidence,client:e.client,worldId,spatial:modelOptions('spatial',e.spatialMemory),neural:modelOptions('neural',e.neuralMemory),cognition:modelOptions('cognition',e.cognitionMemory),survival:e.queue?false:brainOptions.survival===false?false:{...brainOptions.survival,target:e.goal,peer:fleet.peers.get(name)},reactors:[...(e.queue?[e.queue.reactor]:[]),...(brainOptions.reactors||[])]});e.queue?.attach(e.brain);
        }
        e.brain.start();
      } else if(command==='settings'){
        if(typeof args.humanizeMode!=='boolean'||!Number.isInteger(args.viewDistance)||args.viewDistance<2||args.viewDistance>32)throw new Error('Настройки: Humanize boolean и обзор 2–32 чанка.');
        e.settings={humanizeMode:args.humanizeMode,viewDistance:args.viewDistance};
        e.client.options.humanizeMode=args.humanizeMode;e.client.options.viewDistance=args.viewDistance;
        if(e.client.state.status==='ready'){
          e.client.world.maxChunks=args.viewDistance>16?2048:1024;
          e.client.write('settings',{locale:'ru_ru',viewDistance:args.viewDistance,chatFlags:0,chatColors:true,skinParts:127,mainHand:1,enableTextFiltering:false,enableServerListing:true});
        }
        await save(name,e);note(name,'settings',`Humanize ${args.humanizeMode?'on':'off'}, обзор ${args.viewDistance} чанков`);
      } else if(command==='buildSchematic'){
        if(!e.schematic)throw new Error('Сначала загрузи схему через панель.');
        if(e.client.state.status!=='ready')throw new Error('Агент должен быть в мире.');
        await e.brain?.pause();
        const selected=args.origin||e.schematicOrigin||findSchematicSite(e.client,e.schematic,{minDistance:16,maxDistance:128})?.origin;
        if(!selected)throw new Error('Свободная ровная площадка не найдена в полученных чанках.');
        const origin={...selected};
        e.schematicOrigin=origin;
        const build=e.client.state.gameMode==='creative'?buildSchematicPhysical:buildSchematic;
        const result=await build(e.client,e.schematic,origin,{signal:AbortSignal.timeout(180000),maxActions:Math.min(32,Math.max(1,Number(args.maxActions)||16))});
        note(name,'buildSchematic',`${result.status}: ${result.actions} действий`);return {...result,origin};
      } else if(command==='tasks'){
        const tasks=validateTasks(args.tasks,{skills:e.client.describe().skills});
        await e.brain?.stop();retain(e);e.brain=null;e.queue=null;e.tasks=tasks;e.taskState=[];await save(name,e);note(name,'tasks',`Назначено задач: ${tasks.length}`);
      } else if(command==='taskRetry'){
        await e.brain?.pause();if(!e.queue)throw new Error('Сначала запусти очередь.');e.queue.retry(args.id);await save(name,e);
      } else if(command==='goal') {
        if(!['wood','stone_tools','iron_pickaxe','diamond_set'].includes(args.target))throw new Error('Цель: wood, stone_tools, iron_pickaxe, diamond_set.');
        await e.brain?.stop();retain(e);e.brain=null;e.queue=null;e.tasks=[];e.taskState=[];e.goal=args.target;await save(name,e);
      } else if(command==='action') {
        await e.brain?.pause();
        return await e.client.execute(args,{priority:500,signal:AbortSignal.timeout(60000)});
      } else if(command==='give'||command==='trade') {
        const other=entries.get(args.to);if(!other||other===e)throw new Error('Выбери другого получателя.');
        if(other.busy)throw new Error('Получатель занят.');other.busy=true;
        try{
          await e.brain?.pause();await other.brain?.pause();
          const clients=[...entries.values()].map(e=>e.client);
          return command==='give'?await runInteraction({from:e.client,to:other.client,kind:'give',item:args.item,count:args.count??1,peers:fleet.peers}):await runTrade({from:e.client,to:other.client,fromTargets:teamSupplyTargets(e.client,clients,targets(e)),toTargets:teamSupplyTargets(other.client,clients,targets(other)),peers:fleet.peers});
        }finally{other.busy=false;}
      } else throw new Error('Неизвестная команда управления.');
      return snapshot();
    } catch(error){e.error=String(error.message);note(name,'error',e.error);throw error;}
    finally{e.busy=false;}
  };
  const targets=e=>{const s=e.brain?.survival?.snapshot();return equipmentTradeTargets(e.client,{...s?.targets,...Object.fromEntries((s?.plan||[]).map(p=>[p.item,p.required])),...(s?.stage?{[s.stage.includes(':')?s.stage:'minecraft:'+s.stage]:1}:{}),...supplyTargets});};
  const timer=setInterval(async()=>{
    if(closed)return;
    const available=[...entries].filter(([,e])=>!e.busy&&e.client.state.status==='ready'&&e.brain?.snapshot().running);
    for(const [name,a]of available)for(const [other,b]of available){
      const key=[name,other].sort().join('/');if(a===b||a.busy||b.busy||(blockedTrades.get(key)||0)>Date.now())continue;
      const p=a.client.state.position,q=b.client.state.position;if(!p||!q||Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>16)continue;
      const clients=available.map(([,e])=>e.client);
      const transfer=proposeTeamTransfer({clients:[a.client,b.client],targets:c=>teamSupplyTargets(c,clients,targets(c===a.client?a:b))});
      if(!transfer||transfer.from!==a.client)continue;
      try{const result=await execute(name,'trade',{to:other});note(name,'trade',`${other}: ${result.status}`);if(['partial','failed'].includes(result.status))blockedTrades.set(key,result.status==='partial'?Infinity:Date.now()+30000);}
      catch(error){note(name,'trade-error',error.message);blockedTrades.set(key,Date.now()+30000);}
      finally{if(!closed){if(a.client.state.status==='ready')a.brain?.start();if(b.client.state.status==='ready')b.brain?.start();}}
      return;
    }
  },4000);timer.unref();
  const persistence=setInterval(()=>{if(!closed&&memory)for(const [name,e]of entries)if(e.loaded)void save(name,e).catch(error=>note(name,'memory-error',error.message));},15000);persistence.unref();
  const ready=Promise.all([...entries].map(async([name,e])=>{try{await restore(name,e);}catch(error){e.error=String(error.message);note(name,'memory-error',e.error);}}));
  return {fleet,entries,snapshot,importSchematic,vision(name,options){const e=entries.get(name);if(!e)throw new Error('Неизвестный агент.');return createVisionSnapshot(e.client,options);},execute,ready,close(){
    if(!closing){
      closed=true;clearInterval(timer);clearInterval(persistence);
      closing=(async()=>{
        await ready;
        const errors=[];
        for(const [name,e]of entries){
          try{await e.brain?.stop();}catch(error){errors.push(error);}
          try{if(e.loaded)await save(name,e);}catch(error){errors.push(error);}
        }
        try{await fleet.close();}catch(error){errors.push(error);}
        try{await memory?.flush();}catch(error){if(!errors.includes(error))errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Клиенты закрыты, но завершение работы содержит ошибки.');
      })();
    }
    return closing;
  }};
}
