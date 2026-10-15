import { traceProjectile, projectileProfile } from './projectiles.js';

/** Arrow entities may receive sparse server updates; advance only their defensive read view. */
export function shieldEntities(client) {
  return [...client.entities.values()].map(e=>['arrow','spectral_arrow','trident'].includes(e.name)&&client.entityMotion?client.entityMotion.projectile(e,{getBlock:p=>client.world.blockAt(p)}):e);
}

export function usingRangedWeapon(entity) {
  const flags=entity.metadata?.living_entity_flags??0,hand=flags&2?1:0;
  return Boolean(flags&1)&&['bow','crossbow','trident'].includes(entity.equipment?.[hand]?.name);
}

function intersects(a,b) {
  let near=0,far=1;
  for(const [axis,min,max] of [['x',-.5,.5],['y',-.15,1.95],['z',-.5,.5]]){
    const d=b[axis]-a[axis];
    if(Math.abs(d)<1e-9){if(a[axis]<min||a[axis]>max)return null;continue;}
    const p=(min-a[axis])/d,q=(max-a[axis])/d;
    near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));if(near>far)return null;
  }
  return near;
}

/** Predict intersections with the moving body, rather than blocking every nearby arrow. */
function impact(self,entity,velocity,horizon,{gravity=.05,drag=.99}={}) {
  let p={...entity.position},v={...velocity};
  const own=self.velocity??{x:0,y:0,z:0},relative=(point,t)=>Object.fromEntries(['x','y','z'].map(k=>[k,point[k]-self.position[k]-(own[k]||0)*Math.min(t,6)]));
  for(let tick=0;tick<horizon;tick++){
    const next={x:p.x+v.x,y:p.y+v.y,z:p.z+v.z},hit=intersects(relative(p,tick),relative(next,tick+1));
    if(hit!==null)return tick+hit;
    p=next;v={x:v.x*drag,y:v.y*drag-gravity,z:v.z*drag};
  }
  return null;
}

/** Defensive only: anticipating a bow never authorizes attacking its player. */
export function shieldThreat(self,entities,{getBlock,anticipate=true}={}) {
  if(!self?.position)return null;
  const candidates=[];
  for(const e of entities){
    if(!e.position||e.visible===false||String(e.ownerId)===String(self.entityId)&&self.entityId!=null)continue;
    if(Math.hypot(e.position.x-self.position.x,e.position.y-self.position.y,e.position.z-self.position.z)>48)continue;
    if(['arrow','spectral_arrow','trident','fireball','small_fireball'].includes(e.name)&&e.velocity&&[e.velocity.x,e.velocity.y,e.velocity.z].every(Number.isFinite)&&Math.hypot(e.velocity.x,e.velocity.y,e.velocity.z)>.05&&Math.hypot(e.velocity.x,e.velocity.y,e.velocity.z)<=4){
      const profile=e.name.includes('fireball')?{gravity:0,drag:1,waterDrag:1}:projectileProfile(e.name==='trident'?'trident':'bow');
      const ticks=impact(self,e,e.velocity,16,profile);
      if(ticks===null)continue;
      if(getBlock&&traceProjectile({origin:e.position,velocity:e.velocity,ticks:Math.max(.01,ticks),profile,getBlock}).status!=='clear')continue;
      candidates.push({entity:e,point:{...e.position},ticks,anticipating:false});
    }else if(anticipate&&(e.aimingRanged===true||usingRangedWeapon(e))&&Number.isFinite(e.yaw)&&Number.isFinite(e.pitch)){
      const yaw=e.yaw*Math.PI/180,pitch=e.pitch*Math.PI/180;
      const velocity={x:-3*Math.sin(yaw)*Math.cos(pitch),y:-3*Math.sin(pitch),z:3*Math.cos(yaw)*Math.cos(pitch)};
      const origin={...e.position,y:e.position.y+1.52},ticks=impact(self,{position:origin},velocity,12);
      if(ticks===null||getBlock&&traceProjectile({origin,velocity,ticks:Math.max(.01,ticks),getBlock}).status!=='clear')continue;
      candidates.push({entity:e,point:origin,ticks:20+ticks,anticipating:true});
    }
  }
  return candidates.sort((a,b)=>a.ticks-b.ticks)[0]??null;
}
