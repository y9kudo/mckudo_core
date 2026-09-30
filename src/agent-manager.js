import { createFleet, createKudoConnect } from '../kudoconnect/index.js';
import { createMinecraftBrain } from './minecraft-brain.js';
import { runInteraction } from './interactions.js';
import { runTrade } from './trade.js';
import { equipmentTradeTargets } from './equipment-policy.js';
import {proposeTeamTransfer,teamSupplyTargets} from './cooperation.js';

/** Application-level lifecycle, independent of the HTTP presentation layer. */
export function createAgentManager({ count = 3, names = ['Owen','Liam','Noah','Mason','Lucas','Ethan','James','Oliver','Henry','Logan'].slice(0,count), connection = {}, worldId = 'local-survival', createClient = createKudoConnect, createBrain = createMinecraftBrain } = {}) {
  const fleet = createFleet({count,names,connection,createClient}), entries = new Map(), log = [], blockedTrades=new Map();
  let closed=false;
  const note = (name,event,detail='') => {log.push({at:Date.now(),name,event,detail:String(detail).slice(0,500)});if(log.length>200)log.shift();};
  const wire = (name,client) => {
    const old = entries.get(name), entry = {client,brain:null,busy:false,error:'',goal:old?.goal || 'diamond_set',survival:null};
    entries.set(name,entry);client.managedNames=new Set(names.map(n=>n.toLowerCase()));
    for(const event of ['warning','fault'])client.on(event,e=>{entry.error=String(e.message);note(name,event,e.message);});
    client.on('action',e=>note(name,e.skill,`${e.outcome} ${e.detail}`));
    client.on('death',()=>{void entry.brain?.stop();note(name,'death');});
    client.on('end',()=>{void entry.brain?.stop();note(name,'disconnected');});
    return entry;
  };
  for(const [name,client]of fleet.agents)wire(name,client);
  const snapshot = () => ({worldId,agents:[...entries].map(([name,e])=>({name,busy:e.busy,error:e.error,goal:e.goal,state:e.client.snapshot(),inventory:e.client.inventory.items().map(i=>({item:i.item,name:i.name,count:i.count,slot:i.slot})),brain:e.brain?.snapshot() || null,survival:e.brain?.survival?.snapshot() || null,skills:e.client.describe().skills})),log:[...log]});
  const execute = async(name,command,args={}) => {
    let e=entries.get(name);if(!e)throw new Error('Неизвестный агент.');
    if(command==='pause'){await e.brain?.pause();e.client.pending?.abort.abort(new Error('Остановлено в панели.'));await e.client.pending?.promise.catch(()=>{});return snapshot();}
    if(e.busy)throw new Error('Предыдущее управление ещё выполняется.');e.busy=true;e.error='';
    try {
      if(command==='connect') {
        if(e.client.state.status==='disconnected') {
          if(e.client.connectedOnce){await e.brain?.stop();await e.client.close();e=wire(name,createClient({...connection,username:name}));e.busy=true;fleet.agents.set(name,e.client);}
          await e.client.connect();note(name,'connected');
        }
      } else if(command==='disconnect'){await e.brain?.stop();await e.client.close();}
      else if(command==='respawn'){await e.brain?.stop();await e.client.respawn();note(name,'respawn');}
      else if(command==='start'){
        if(e.client.state.status!=='ready')throw new Error('Сначала подключи или возроди агента.');
        if(!e.brain)e.brain=createBrain({client:e.client,worldId,storage:{maxStacks:54},survival:{target:e.goal,peer:fleet.peers.get(name)}});
        e.brain.start();
      } else if(command==='goal') {
        if(!['wood','stone_tools','iron_pickaxe','diamond_set'].includes(args.target))throw new Error('Цель: wood, stone_tools, iron_pickaxe, diamond_set.');
        await e.brain?.stop();e.brain=null;e.goal=args.target;
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
  const targets=e=>{const s=e.brain?.survival?.snapshot();return equipmentTradeTargets(e.client,{...s?.targets,...(s?.stage?{[s.stage.includes(':')?s.stage:'minecraft:'+s.stage]:1}:{})});};
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
  return {fleet,entries,snapshot,execute,async close(){closed=true;clearInterval(timer);for(const e of entries.values())await e.brain?.stop();await fleet.close();}};
}
