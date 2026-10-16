import { planRouteAsync, readRouteWorld } from '../packages/omconnect/src/navigation.js';
import { bridgeMaterials, routeCanDig } from '../packages/omconnect/src/movement.js';
import { editDecision } from '../packages/omconnect/src/protection.js';
import { createBlockTaxonomy } from './taxonomy.js';
import { leaseNavigationRoute } from '../packages/omconnect/src/route-lease.js';
import {planSafeAscent} from '../packages/omconnect/src/ascent.js';

const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
const key=p=>`${p.x},${p.y},${p.z}`;

/** Goal-level navigation: bounded asynchronous segments, material prerequisites,
 * and temporary avoidance of failed waypoints. The client executes real physics. */
export function createNavigationGoal({ client, position, range=1, bridge=true, excavate=false, catalog, resourceFactory, planner=planRouteAsync, clock=Date.now }) {
  const goal=floor(position), taxonomy=createBlockTaxonomy(catalog), failed=new Map(), suppliers=new Map();
  let dimension, pending, ready, activeResource, issued, ascent, ascentMode=false, lastReason="Waiting for position.";
  const idle=reason=>{lastReason=reason;return {action:null,reason};};
  const materials=()=>bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block?.fromStateId(id,0),itemValue:client.options?.bridgeItemValue,reserve:client.options?.bridgeReserve??0,dimension:client.state.dimension});
  const ascentDecision=start=>{
    if(!excavate||goal.y<=start.y)return null;
    const step=planSafeAscent({position:start,toward:goal,getBlock:p=>client.world.blockAt(p),canDig:routeCanDig(client,{requireHarvest:false}),buildingBlock:materials()[0]?.block,canPlace:p=>editDecision(client,'place',p).allowed,occupied:p=>failed.has(key(p))||[...client.entities.values()].some(e=>e.kind==='player'&&String(e.id)!==String(client.state.entityId)&&e.position&&Math.hypot(e.position.x-p.x-.5,e.position.y-p.y,e.position.z-p.z-.5)<1.2)});
    if(!step)return null;ascent=step;ascentMode=true;
    return {priority:20,action:step.action.skill==='dig'?{...step.action,args:{...step.action.args,preservePickaxeTier:2,dropRequired:false}}:step.action,reason:step.reason};
  };
  const signature=(o,available)=>[o.dimension,key(floor(o.self.position)),client.protection?.revision,client.inventory.revision,o.self.health,available,...failed.keys(),...[...client.entities.values()].filter(e=>e.kind==='player'&&String(e.id)!==String(client.state.entityId)&&e.position).map(e=>String(e.id)+':'+key(floor(e.position))).sort()].join('/');
  return {
    react(o) {
      activeResource=null;ascent=null;
      if(!o.self?.position)return idle("Navigation requires a observed position.");
      dimension??=o.dimension;
      if(o.dimension!==dimension)return idle("Measurement changed. Set a new target in the current measurement.");
      const start=floor(o.self.position);
      if(client.state.onGround && ['x','y','z'].every(k=>Math.abs(start[k]-goal[k])<=range))return null;
      if(!client.state.onGround)return idle("Before planning, wait for a steady support.");
      for(const [k,v] of failed)if(v.until<=clock())failed.delete(k);
      if(ascentMode){const next=ascentDecision(start);if(next)return next;ascentMode=false;}
      const available=bridge?Math.min(256,materials().reduce((n,b)=>n+b.count,0)):0;
      const token=signature(o,available);
      if(ready?.token!==token || ready?.isCurrent && !ready.isCurrent())ready=null;
      if(ready?.error){if(clock()<ready.retryAt)return idle(ready.error);ready=null;}
      if(!ready) {
        if(pending)return idle("Core is counting a safe path.");
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
        return idle("Core is counting a safe path.");
      }
      const plan=ready.plan;
      // A deterministic blocked search remains blocked until its actual inputs change.
      if(plan.status!=='planned'){
        const next=ascentDecision(start);if(next)return next;
        return idle(plan.reason);
      }
      const missing=Math.max(0,(plan.bridgeUsed||0)-available);
      if(missing) {
        if(!resourceFactory)return idle(`There's not enough for a bridge ${missing} Construction blocks. Connect resourceFactory.`);
        // Obtain interchangeable natural stone, using the normal tool/recipe
        // planner. Existing expendable wood/dirt also counts toward the span.
        const current=taxonomy.members('stone').reduce((n,id)=>n+(o.inventory?.[id]||0),0), needed=current+missing;
        if(!suppliers.has(needed)){if(suppliers.size>=8)suppliers.delete(suppliers.keys().next().value);suppliers.set(needed,resourceFactory({'#stone':needed}));}
        activeResource=suppliers.get(needed);
        const decision=activeResource.react(o);
        return {...decision,reason:`Prepare ${missing} Bridge blocks. ${decision.reason||''}`};
      }
      const target=plan.target||plan.steps.at(-1)?.position;
      if(!target)return idle("The route does not contain a confirmed section of traffic.");
      issued={position:{...target},dimension:o.dimension};
      lastReason=plan.partial?"Go through a known area and count the path after new observations.":"To reach target on a proven route.";
      const args={...target,range:0,bridge,excavate,maxDrop:3};
      const lease=leaseNavigationRoute(client,plan,start,args,ready.isCurrent);
      if(lease)args.routeLease=lease;
      return {priority:20,action:{skill:'navigate',args},reason:lastReason};
    },
    recordResult(event,action) {
      if(ascent){if(event.outcome==='failure'){if(failed.size>=64)failed.delete(failed.keys().next().value);failed.set(key(ascent.destination),{until:clock()+10000});ascentMode=false;}ascent=null;ready=null;return;}
      if(activeResource){activeResource.recordResult?.(event,action);activeResource=null;ready=null;return;}
      if(action?.skill==='navigate'&&issued){
        if(event.outcome==='failure'){
          if(failed.size>=64)failed.delete(failed.keys().next().value);
          failed.set(key(issued.position),{until:clock()+10000});
        }
        issued=null;ready=null;
      }
    },
    snapshot:()=>({goal:{...goal},dimension:dimension??null,status:pending?'planning':ready?.error||ready?.plan?.status==='blocked'?'blocked':'ready',planning:Boolean(pending),avoided:failed.size,reason:lastReason})
  };
}
