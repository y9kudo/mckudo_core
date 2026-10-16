import {traceVisibility} from '../packages/omconnect/src/visibility.js';
import {shieldEntities,usingRangedWeapon} from '../packages/omconnect/src/shield-threats.js';
import {wearsGold} from '../packages/omconnect/src/bartering.js';

const projectiles=new Set(['arrow','spectral_arrow','trident','small_fireball','fireball']);
const hostileNames=new Set(['zombie','husk','drowned','skeleton','stray','creeper','blaze','wither_skeleton','witch','phantom','pillager','spider','cave_spider','ghast','magma_cube','hoglin','zoglin','piglin_brute']);
export const hostileEntity=(entity,{dimension,gold=false}={})=>hostileNames.has(entity.name)||entity.name==='piglin'&&dimension==='minecraft:the_nether'&&!gold;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const better=(a,b)=>a.tier-b.tier||a.distance-b.distance||a.id.localeCompare(b.id);
const valid=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));

/** Keep the most relevant K entities without sorting the entire connection cache. */
export function selectPerceivedEntities(entities,{position,radius=192,limit=128,attackers=[],dimension,gold=false}={}){
  if(!valid(position)||!Number.isInteger(limit)||limit<1||limit>128||!Number.isFinite(radius)||radius<1||radius>512)throw new Error('Invalid entity selection budget.');
  const heap=[],hits=new Set(attackers.map(a=>String(a.entityId)));let considered=0;
  for(const entity of entities){
    if(!valid(entity.position))continue;const d=distance(position,entity.position);if(d>radius)continue;considered++;
    const incoming=projectiles.has(entity.name)&&(!valid(entity.velocity)||Math.hypot(entity.velocity.x,entity.velocity.y,entity.velocity.z)>.05&&['x','y','z'].reduce((v,k)=>v+(position[k]-entity.position[k])*entity.velocity[k],0)>0);
    const tier=incoming?0:usingRangedWeapon(entity)?1:hits.has(String(entity.id))?2:hostileEntity(entity,{dimension,gold})?3:entity.kind==='player'?4:entity.name==='item'?6:5;
    const row={entity,tier,distance:d,id:String(entity.id)};
    if(heap.length<limit){
      heap.push(row);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(better(heap[p],heap[i])>=0)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}
    }else if(better(row,heap[0])<0){
      heap[0]=row;let i=0;
      for(;;){const l=i*2+1,r=l+1;let worst=i;if(l<heap.length&&better(heap[l],heap[worst])>0)worst=l;if(r<heap.length&&better(heap[r],heap[worst])>0)worst=r;if(worst===i)break;[heap[i],heap[worst]]=[heap[worst],heap[i]];i=worst;}
    }
  }
  return {entities:heap.sort(better),considered,omitted:Math.max(0,considered-heap.length)};
}

export function createEntitySensor(client,{radius=192,maxRays=24,visibilityDistance=48,clock=Date.now,tracker}={}){
  if(!Number.isInteger(maxRays)||maxRays<1||maxRays>128||!Number.isInteger(visibilityDistance)||visibilityDistance<16||visibilityDistance>96)throw new Error('Entity visibility budget: 1–128 rays and distance 16–96.');
  const cache=new Map();let last={considered:0,selected:0,omitted:0,rays:0,cacheHits:0,maxRays,visibilityDistance};
  return {
    read(){
      const p=client.state.position;if(!valid(p))throw new Error('Entity perception needs an observed position.');
      const now=clock(),attackers=[...client.attackers.values()].filter(a=>now-a.lastHitAt>=0&&now-a.lastHitAt<10000);
      const gold=wearsGold(client.inventory.equipment()),chosen=selectPerceivedEntities(shieldEntities(client),{position:p,radius,attackers,dimension:client.state.dimension,gold});
      let rays=0,cacheHits=0;
      const entities=chosen.entities.map(({entity:e,distance:d})=>{
        let visible=null,visibilityReason=d>visibilityDistance?'distance':'budget';
        const target={...e.position,y:e.position.y+Math.min(1,(client.registry.entitiesByName[e.name]?.height??1.8)*.6)};
        const key=[client.state.dimension,client.world.revision,p.x,p.y,p.z,target.x,target.y,target.z].join('/'),saved=cache.get(String(e.id));
        if(saved&&saved.key===key&&now>=saved.at&&now-saved.at<250){({visible,reason:visibilityReason}=saved);cacheHits++;}
        else if(d<=visibilityDistance&&rays<maxRays){
          const result=traceVisibility({origin:{...p,y:p.y+1.62},target,getBlock:q=>client.world.blockAt(q),maxDistance:Math.min(128,visibilityDistance+2)});rays++;
          visible=result.reason==='unloaded'?null:result.visible;visibilityReason=result.reason;
          cache.delete(String(e.id));cache.set(String(e.id),{key,at:now,visible,reason:visibilityReason});
        }
        const evidence=tracker?.evidence(e.id)||{source:'unknown',ageMs:null,confidence:0};
        return {e,visible,visibilityReason,evidence};
      });
      while(cache.size>256)cache.delete(cache.keys().next().value);
      last={considered:chosen.considered,selected:entities.length,omitted:chosen.omitted,rays,cacheHits,maxRays,visibilityDistance};
      return {entities,attackers,gold,metrics:{...last}};
    },
    snapshot:()=>({...last}),
    clear(){cache.clear();}
  };
}
