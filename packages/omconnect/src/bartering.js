import {setTimeout as delay} from 'node:timers/promises';
import {traceVisibility} from './visibility.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export const wearsGold=equipment=>Object.entries(equipment||{}).some(([slot,item])=>['head','chest','legs','feet'].includes(slot)&&/^golden_(helmet|chestplate|leggings|boots)$/.test((item?.name||item?.item||'').replace(/^minecraft:/,'')));
export const piglinAngerRisk=(dimension,position,entities,radius=16)=>dimension==='minecraft:the_nether'&&[...entities].some(e=>e.name==='piglin'&&e.position&&distance(e.position,position)<=radius);

/** One ingot, one server-confirmed consumption. A random drop is not a promised pearl. */
export async function barter(c,args,signal,{select,run}){
  signal.throwIfAborted();
  const target=c.entities.get(Number(args.entityId));
  const adult=e=>e?.name==='piglin'&&(e.metadata?.baby===false||e.metadata?.is_baby===false);
  const check=()=>{
    signal.throwIfAborted();
    if(c.state.status!=='ready'||c.state.health<=8||c.state.dimension!=='minecraft:the_nether')throw new Error("barter: I need a live agent in Neser with a health supply.");
    if(c.entities.get(Number(args.entityId))!==target||!adult(target))throw new Error("barter: You need a grown-up, seen pigline; Kids and ruts don't fit.");
    if(!wearsGold(c.inventory.equipment()))throw new Error("barter: First put on the gold part of the armor.");
    if([...c.attackers.values()].some(a=>String(a.entityId)===String(target.id)&&Date.now()-a.lastHitAt<30000))throw new Error("barter: An attacker pigline is not considered peaceful.");
    if([...c.entities.values()].some(e=>e.name==='piglin_brute'&&distance(e.position,c.state.position)<12))throw new Error("barter: There's a piglin next to you-Brute.");
  };
  check();
  if(!c.inventory.count('gold_ingot')||c.inventory.slots.slice(9,45).every(Boolean))throw new Error("barter: You need a click and a free slot for a random reward.");
  if(distance(c.state.position,target.position)>3){
    await run(c,{skill:'navigate',args:{x:Math.floor(target.position.x),y:Math.floor(target.position.y),z:Math.floor(target.position.z),range:1,bridge:false,sprintJump:false}},signal);
  }
  check();
  const aim={...target.position,y:target.position.y+1};
  if(distance(c.state.position,target.position)>3||!traceVisibility({origin:{...c.state.position,y:c.state.position.y+1.62},target:aim,getBlock:p=>c.world.blockAt(p),maxDistance:5}).visible)throw new Error("barter: Piglin is out of reach or closed by blocks.");
  if(target.equipment?.[1]?.name==='gold_ingot'||target.metadata?.is_charging_crossbow===true)throw new Error("barter: Piglin's busy.");
  await select(c,'gold_ingot',signal);check();c.stopMovement();c.lookAt(aim);await c.waitForLook?.({signal});check();
  const before=c.inventory.count('gold_ingot'),initial=new Set(c.entities.keys()),dimension=c.state.dimension;
  c.write('use_entity',{target:Number(target.id),mouse:0,hand:0,sneaking:false});c.write('arm_animation',{hand:0});
  await c.waitFor(()=>c.inventory.count('gold_ingot')===before-1,{event:'inventory',signal,timeoutMs:3000});
  c.metrics??={};c.metrics.barterGoldSpent=(c.metrics.barterGoldSpent||0)+1;
  const drops=new Map(),deadline=Date.now()+8000;
  while(Date.now()<deadline){
    check();if(c.state.dimension!==dimension)throw new Error("barter: measurement changed.");
    for(const [id,e]of c.entities)if(!initial.has(id)&&e.name==='item'&&e.item&&distance(e.position,target.position)<6){
      drops.set(String(id),{entityId:String(id),item:e.item.item||'minecraft:'+e.item.name,count:e.item.count,position:{...e.position}});
    }
    if(drops.size)break;
    await delay(50,undefined,{signal});
  }
  const result={ok:true,serverConfirmed:true,consumed:1,entityId:String(target.id),dropsObserved:[...drops.values()],rewardConfirmed:false};
  // No owner exists in dropped-item packets. Do not label a nearby player's drop as our reward.
  c.emit('barter',result);return result;
}
