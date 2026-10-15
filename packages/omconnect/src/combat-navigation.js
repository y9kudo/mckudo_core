import {planRouteAsync, readRouteWorld, isAir, isFullBlock} from './navigation.js';
import {safeCorridor, combatControl} from './movement.js';
import {OMActionError} from './failures.js';

const floor = p => ({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Persists across short combat frames; walking in circles is not progress toward a target. */
export class CombatPursuit {
  constructor({stuckMs=3000, maxChaseMs=15000}={}) {
    this.stuckMs=stuckMs;this.maxChaseMs=maxChaseMs;this.record=null;
  }
  observe({target,position,dimension,now,maxDistance=12,inReach}) {
    const d=distance(position,target.position);
    let r=this.record;
    if(!r||r.target!==target||r.dimension!==dimension||now-r.lastSeen>2000) r=this.record={target,dimension,origin:{...position},started:now,progress:now,lastSeen:now,best:d};
    r.lastSeen=now;r.lastPosition={...position};
    if(d<r.best-.35){r.best=d;r.progress=now;}
    if(distance(r.origin,position)>maxDistance*2) return {allowed:false,reason:"Overrided pursuit radius from the meeting point."};
    if((inReach===undefined?d>2.8:!inReach)&&now-r.progress>this.stuckMs||now-r.started>this.maxChaseMs)return {allowed:false,reason:'No observed progress in this pursuit; reconsider the target.'};
    return {allowed:true};
  }
  attackSent(now) {if(this.record)this.record.lastAttack=now;}
  damageConfirmed(now) {
    if(this.record){
      this.record.progress=now;this.record.started=now;this.record.best=Infinity;
      // A continuing, confirmed exchange can move away from the initial meeting.
      // Packet-only attacks never move this leash or renew the encounter budget.
      if(this.record.lastPosition)this.record.origin={...this.record.lastPosition};
    }
  }
}

/** Small, cached, non-destructive pursuit route. No bridges, digging or blind drops. */
export async function combatApproach(c,target,signal,{now=performance.now()}={}) {
  signal.throwIfAborted();
  const position=c.state.position,getBlock=p=>c.world.blockAt(p),goal=floor(target.position);
  let cache=c.combatRoute;
  const same=cache&&cache.dimension===c.state.dimension&&cache.target===target&&distance(cache.goal,goal)<1&&cache.isCurrent()&&now<cache.until;
  if(!same){
    c.combatRoute=cache=null;
    const dx=target.position.x-position.x,dz=target.position.z-position.z,d=Math.hypot(dx,dz);
    if(Math.abs(target.position.y-position.y)<.5&&safeCorridor(position,{x:dx,z:dz},Math.min(3,d),getBlock))return combatControl(c.state,target.position,'approach',getBlock);
    if(!c.state.onGround)return {x:0,z:0,jump:false,sprint:false};
    const view=readRouteWorld(c.world),start=floor(position),corrections=c.metrics.corrections,revision=view.getRevision();
    const occupied=p=>[...c.entities.values()].some(e=>e!==target&&e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(c.state.entityId)&&Math.abs(e.position.y-p.y)<1.8&&Math.hypot(e.position.x-p.x-.5,e.position.z-p.z-.5)<.8);
    const plan=await planRouteAsync({start,goal,range:1,getBlock:view.getBlock,occupied,maxDistance:16,maxNodes:1600,maxDrop:1,bridgeBudget:0,canDig:()=>false,signal},{getRevision:view.getRevision});
    signal.throwIfAborted();
    if(c.entities.get(Number(target.id))!==target||corrections!==c.metrics.corrections||distance(start,floor(c.state.position))>0)throw new OMActionError('STALE_WORLD', 'Combat position changed during route search.');
    cache=c.combatRoute={target,dimension:c.state.dimension,goal,isCurrent:()=>view.getRevision()===revision,until:performance.now()+800,planned:plan.status==='planned',steps:plan.status==='planned'?plan.steps:[]};
  }
  if(!cache.planned)return {x:0,z:0,jump:false,sprint:false};
  while(cache.steps.length){
    const step=cache.steps[0],p=step.position,dx=p.x+.5-c.state.position.x,dz=p.z+.5-c.state.position.z,d=Math.hypot(dx,dz);
    if(d<.2&&Math.abs(c.state.position.y-p.y)<.1&&c.state.onGround){cache.steps.shift();continue;}
    if(!isAir(getBlock(p))||!isAir(getBlock({...p,y:p.y+1}))||!isFullBlock(getBlock({...p,y:p.y-1}))) {c.combatRoute=null;return {x:0,z:0,jump:false,sprint:false};}
    if(!['walk','jump','drop'].includes(step.kind))throw new Error("Battle-by-clock should not change the world.");
    const speed=d<.7?Math.max(.12,d):1;
    return {x:dx/(d||1)*speed,z:dz/(d||1)*speed,sprint:false,jump:step.kind==='jump'&&c.state.onGround};
  }
  return combatControl(c.state,target.position,'approach',getBlock);
}
