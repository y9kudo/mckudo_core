import { planRouteAsync, readRouteWorld } from '../packages/kudoconnect/src/navigation.js';
import { bridgeMaterials, routeCanDig } from '../packages/kudoconnect/src/movement.js';
import { editDecision } from '../packages/kudoconnect/src/protection.js';
import { createBlockTaxonomy } from './taxonomy.js';

const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
const key=p=>`${p.x},${p.y},${p.z}`;

/** Goal-level navigation: bounded asynchronous segments, material prerequisites,
 * and temporary avoidance of failed waypoints. The client executes real physics. */
export function createNavigationGoal({ client, position, range=1, bridge=true, excavate=false, catalog, resourceFactory, planner=planRouteAsync, clock=Date.now }) {
  const goal=floor(position), taxonomy=createBlockTaxonomy(catalog), failed=new Map(), suppliers=new Map();
  let dimension, pending, ready, activeResource, issued, lastReason='Ожидание позиции.';
  const idle=reason=>{lastReason=reason;return {action:null,reason};};
  const materials=()=>bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block?.fromStateId(id,0),itemValue:client.options?.bridgeItemValue,reserve:client.options?.bridgeReserve??0});
  const signature=(o,available)=>[o.dimension,key(floor(o.self.position)),client.protection?.revision,available,...failed.keys()].join('/');
  return {
    react(o) {
      activeResource=null;
      if(!o.self?.position)return idle('Для навигации нужна наблюдаемая позиция.');
      dimension??=o.dimension;
      if(o.dimension!==dimension)return idle('Измерение изменилось. Задай новую цель в текущем измерении.');
      const start=floor(o.self.position);
      if(client.state.onGround && ['x','y','z'].every(k=>Math.abs(start[k]-goal[k])<=range))return null;
      if(!client.state.onGround)return idle('Перед планированием дождаться устойчивой опоры.');
      for(const [k,v] of failed)if(v.until<=clock())failed.delete(k);
      const available=bridge?Math.min(256,materials().reduce((n,b)=>n+b.count,0)):0;
      const token=signature(o,available);
      if(ready?.token!==token || ready?.isCurrent && !ready.isCurrent())ready=null;
      if(ready?.error){if(clock()<ready.retryAt)return idle(ready.error);ready=null;}
      if(!ready) {
        if(pending)return idle('Ядро рассчитывает безопасный участок пути.');
        const view=readRouteWorld(client.world), revision=view.getRevision(), isCurrent=()=>view.getRevision()===revision;
        const signal=AbortSignal.any([client.connectionAbort.signal,AbortSignal.timeout(2500)]);
        const job={token};pending=job;
        const occupied=p=>failed.has(key(p))||[...client.entities.values()].some(e=>e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(client.state.entityId)&&e.position&&Math.abs(e.position.y-p.y)<1.8&&Math.hypot(e.position.x-(p.x+.5),e.position.z-(p.z+.5))<.8);
        Promise.resolve().then(()=>planner({start,goal,range,getBlock:view.getBlock,occupied,maxDistance:32,maxNodes:4096,maxDrop:3,
          fallPolicy:{health:o.self.health??20,minHealthAfter:client.options?.fallHealthReserve??6,maxDamage:client.options?.maxFallDamage??6},
          bridgeBudget:bridge?Math.max(available,32):0,canPlace:p=>editDecision(client,'place',p).allowed,
          canDig:excavate?routeCanDig(client):()=>false,edgeCost:client.navigationPolicy?.cost,allowPartial:true,signal}, {getRevision:view.getRevision}))
          .then(plan=>{ready={token,plan,isCurrent};},error=>{ready={token,error:String(error.message),retryAt:clock()+1000,isCurrent};})
          .finally(()=>{if(pending===job)pending=null;client.emit('planningReady');});
        return idle('Ядро рассчитывает безопасный участок пути.');
      }
      const plan=ready.plan;
      if(plan.status!=='planned') { const reason=plan.reason;ready={...ready,error:reason,retryAt:clock()+1000};return idle(reason); }
      const missing=Math.max(0,(plan.bridgeUsed||0)-available);
      if(missing) {
        if(!resourceFactory)return idle(`Для моста не хватает ${missing} строительных блоков. Подключи resourceFactory.`);
        // Obtain interchangeable natural stone, using the normal tool/recipe
        // planner. Existing expendable wood/dirt also counts toward the span.
        const current=taxonomy.members('stone').reduce((n,id)=>n+(o.inventory?.[id]||0),0), needed=current+missing;
        if(!suppliers.has(needed)){if(suppliers.size>=8)suppliers.delete(suppliers.keys().next().value);suppliers.set(needed,resourceFactory({'#stone':needed}));}
        activeResource=suppliers.get(needed);
        const decision=activeResource.react(o);
        return {...decision,reason:`Подготовить ${missing} блоков для моста. ${decision.reason||''}`};
      }
      const target=plan.target||plan.steps.at(-1)?.position;
      if(!target)return idle('Маршрут не содержит подтверждённого участка движения.');
      issued={position:{...target},dimension:o.dimension};
      lastReason=plan.partial?'Пройти известный участок и пересчитать путь после новых наблюдений.':'Дойти до цели по проверенному маршруту.';
      return {priority:20,action:{skill:'navigate',args:{...target,range:0,bridge,excavate,maxDrop:3}},reason:lastReason};
    },
    recordResult(event,action) {
      if(activeResource){activeResource.recordResult?.(event,action);activeResource=null;ready=null;return;}
      if(action?.skill==='navigate'&&issued){
        if(event.outcome==='failure'){
          if(failed.size>=64)failed.delete(failed.keys().next().value);
          failed.set(key(issued.position),{until:clock()+10000});
        }
        issued=null;ready=null;
      }
    },
    snapshot:()=>({goal:{...goal},dimension:dimension??null,planning:Boolean(pending),avoided:failed.size,reason:lastReason})
  };
}
