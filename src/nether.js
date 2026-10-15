import {catalogFromMinecraftData,resourceId} from './catalog.js';
import {createSurvivalReactor} from './survival-brain.js';
import {planExploration} from './exploration.js';
import {isAir,isFullBlock,isHazard} from './navigation.js';
import {wearsGold} from '../packages/omconnect/src/bartering.js';
import {bridgeMaterials} from '../packages/omconnect/src/movement.js';

const NETHER='minecraft:the_nether';
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const floor=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const key=p=>`${p.x},${p.y},${p.z}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const name=b=>(b?.name||b?.id||'').replace(/^minecraft:/,'');
const owned=(o,id)=>(o.inventory?.[id]||0)+Object.values(o.equipment||{}).filter(e=>e?.item===id).reduce((n,e)=>n+e.count,0);
const fortress=new Set(['nether_bricks','nether_brick_fence','nether_brick_stairs','nether_wart']);
export const NETHER_TRACKED_BLOCKS=Object.freeze(['nether_portal','nether_bricks','nether_brick_fence','nether_brick_stairs','nether_wart','soul_sand','soul_soil','warped_nylium','crimson_nylium','ancient_debris','nether_gold_ore','nether_quartz_ore','glowstone','shroomlight','crimson_fungus','warped_fungus','brown_mushroom','red_mushroom']);

/** Static domain facts; actual availability always comes from the connected registry/world. */
export function netherCapabilities(registry){
  const groups={terrain:['netherrack','blackstone','basalt','soul_sand','soul_soil','gravel'],wood:['crimson_stem','warped_stem','crimson_planks','warped_planks'],minerals:['gold_nugget','quartz','glowstone_dust','ancient_debris','netherite_scrap'],mobLoot:['blaze_rod','magma_cream','ghast_tear','ender_pearl','wither_skeleton_skull','porkchop'],brewing:['nether_wart','blaze_powder','brewing_stand'],workstations:['crafting_table','furnace','smithing_table','brewing_stand']};
  return {dimension:NETHER,version:registry.version.minecraftVersion,waterUsable:false,bedsUsable:false,groups:Object.fromEntries(Object.entries(groups).map(([g,items])=>[g,items.filter(i=>registry.itemsByName[i]).map(resourceId)])),recipes:'connected-world-catalog',unknownTerrain:'blocked'};
}

/** A reusable Nether objective. It owns decisions; OMConnect owns packets and confirmation. */
export function createNetherReactor({client,catalog=client?.registry&&catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}),targets={'minecraft:blaze_rod':10,'minecraft:ender_pearl':20},resourceFactory,explorationPlanner,clock=Date.now,maxBarters=64,exploreDistance=0,memory}={}){
  if(!client?.world||!catalog||!Number.isInteger(maxBarters)||maxBarters<0||maxBarters>4096||!Number.isFinite(exploreDistance)||exploreDistance<0||exploreDistance>128)throw new Error('Nether requires a client, catalog, maxBarters 0–4096 and exploreDistance 0–128.');
  const goal=Object.fromEntries(Object.entries(targets).map(([id,n])=>[resourceId(id),n]));
  if(!Object.keys(goal).length||Object.keys(goal).length>32||Object.entries(goal).some(([id,n])=>!catalog.item(id)||!Number.isInteger(n)||n<1||n>4096))throw new Error("Nether.targets: existing items and quantities 1–4096.");
  const visited=[],landmarks=new Map(),failures=new Map(),supplies=new Map();let barters=0,observation,activeResource=null,selected=null,barterBaseline=0;
  let startPosition=null,maxExploredDistance=0;
  let state={status:'waiting',reason:'Waiting for the Nether.',targets:goal,remaining:{...goal},barters:0,landmarks:[],requiredExplorationDistance:exploreDistance,maxExploredDistance:0};
  const supply=(targets,o)=>{const id=JSON.stringify(targets);if(!supplies.has(id))supplies.set(id,resourceFactory?resourceFactory(targets):createSurvivalReactor({client,catalog,targets,explorationPlanner}));activeResource=supplies.get(id);return activeResource.react(o);};
  const act=(skill,args,reason,priority=10)=>({priority,action:{skill,args},reason});
  const blocked=action=>{const f=failures.get(JSON.stringify(action));return f&&f.until>clock()&&f.dimension===observation.dimension&&distance(f.from,observation.self.position)<3;};
  const choose=response=>{if(response?.action&&blocked(response.action))return null;return response;};
  const safeFeet=p=>isAir(client.world.blockAt(p))&&isAir(client.world.blockAt({...p,y:p.y+1}))&&isFullBlock(client.world.blockAt({...p,y:p.y-1}))&&!isHazard(client.world.blockAt({...p,y:p.y-1}));
  function explore(o,toward){
    const here=floor(o.self.position),args={position:here,getBlock:p=>client.world.blockAt(p),visited,radius:32,maxCandidates:24,maxNodes:2500,mode:'surface',candidateCost:p=>toward?Math.min(1000,Math.max(0,48+Math.hypot(p.x-toward.x,p.z-toward.z)-Math.hypot(here.x-toward.x,here.z-toward.z))):0};
    const route=explorationPlanner?explorationPlanner.poll({...args,context:'nether:'+key(toward||here)}):planExploration(args);
    if(route.status==='planned'){const response=choose(act('navigate',{...route.target,range:0,bridge:false,maxDrop:2,sprintJump:false},toward?"Move along the observed route to the Neser orientations.":"Researching Nezer's Safe Deeds."));if(response)return response;}
    // A short dry tunnel is a fallback when cave surfaces have no walkable frontier.
    // Never remove floor, functional blocks, falling ceilings or open a lava pocket.
    const directions=[[1,0],[-1,0],[0,1],[0,-1]].sort((a,b)=>toward?Math.hypot(here.x+a[0]-toward.x,here.z+a[1]-toward.z)-Math.hypot(here.x+b[0]-toward.x,here.z+b[1]-toward.z):0);
    for(const [dx,dz]of directions){
      const p={x:here.x+dx,y:here.y,z:here.z+dz};if(visited.some(v=>key(v)===key(p)))continue;
      if(!isFullBlock(client.world.blockAt({...p,y:p.y-1})))continue;
      const cells=[{...p,y:p.y+1},p];
      if(cells.some(p=>{const b=client.world.blockAt(p);return !isAir(b)&&(!['netherrack','blackstone','basalt'].includes(name(b))||!b.diggable||[[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(([x,y,z])=>{const n=client.world.blockAt({x:p.x+x,y:p.y+y,z:p.z+z});return !n||isHazard(n)||/gravel|sand$/.test(name(n));}));}))continue;
      const cell=cells.find(p=>!isAir(client.world.blockAt(p))),response=choose(cell?act('dig',{...cell,block:resourceId(name(client.world.blockAt(cell)))},"Open a tested dry passage without a support line."):act('navigate',{...p,range:0,bridge:false,maxDrop:2,sprintJump:false},"Continue safe passage in Neser."));
      if(response)return response;
    }
    const blocks=bridgeMaterials(client.registry,client.inventory?.items?.()||[],{dimension:NETHER}).reduce((n,b)=>n+b.count,0);
    if(blocks>=2)for(const [dx,dz]of directions)for(let length=3;length<=Math.min(16,blocks+1);length++){
      const target={x:here.x+dx*length,y:here.y,z:here.z+dz*length};if(!safeFeet(target)||visited.some(v=>key(v)===key(target)))continue;
      let needed=0,clear=true;
      for(let n=1;n<=length;n++){const p={x:here.x+dx*n,y:here.y,z:here.z+dz*n},support=client.world.blockAt({...p,y:p.y-1});if(!isAir(client.world.blockAt(p))||!isAir(client.world.blockAt({...p,y:p.y+1}))||!support||isHazard(support)||!isAir(support)&&!isFullBlock(support)){clear=false;break;}if(isAir(support))needed++;}
      if(clear&&needed&&needed<=blocks){const r=choose(act('bridgeTo',target,"Build a short non-combustible bridge to the confirmed Neser site."));if(r)return r;}
    }
    return {action:null,reason:"There is no safe, unexplored route of Neser: new observation or other passage required."};
  }
  function hunt(o,item,mobs){
    const drop=(o.drops||[]).find(d=>d.item===item&&distance(d.position,o.self.position)<=24);
    if(drop){const r=choose(act('collect',{item,entityId:drop.id,origin:drop.position,timeoutMs:6000},"Pick up Neser's Lut and confirm with inventory.",100));if(r)return r;}
    const enemies=(o.entities||[]).filter(e=>mobs.includes(e.name)&&e.kind!=='player'&&!e.isBaby&&!e.named&&point(e.position)&&distance(e.position,o.self.position)<=32).sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position));
    for(const target of enemies){
      const d=distance(target.position,o.self.position);
      if(target.name==='ghast'||target.name==='blaze'&&d>5&&target.visible===true){if(owned(o,'minecraft:bow')&&owned(o,'minecraft:arrow')){const r=choose(act('shoot',{entityId:target.id},"Shoot for the observed long-range target.",100));if(r)return r;}if(target.name==='ghast')continue;}
      const r=choose(d<=3?act('combat',{entityId:target.id,maxDistance:5,durationMs:600},"Fight for Neser's Resource, by keeping the shield and re-establishing the impact.",100):act('navigate',{...floor(target.position),range:1,bridge:false,maxDrop:2,sprintJump:false},"Approach the observed resource source via the safe route.",100));if(r)return r;
    }
    return null;
  }
  function decide(o){
    if(o.dimension!==NETHER||!point(o.self?.position)||o.self.health==null||o.self.health<=0)return {action:null,reason:"For purpose Nether We need a live agent in Neser."};
    startPosition??={...o.self.position};maxExploredDistance=Math.max(maxExploredDistance,Math.hypot(o.self.position.x-startPosition.x,o.self.position.z-startPosition.z));state.maxExploredDistance=maxExploredDistance;
    const here=floor(o.self.position);if(!visited.some(v=>key(v)===key(here))){visited.push(here);if(visited.length>512)visited.shift();}
    for(const b of o.world?.sampledBlocks||[])if(point(b.position)&&(fortress.has(name(b))||name(b)==='nether_portal'||name(b)==='warped_nylium'))landmarks.set(key(b.position),{name:resourceId(name(b)),position:floor(b.position)});
    for(const [id,b]of landmarks){const actual=client.world.blockAt(b.position);if(actual&&name(actual)!==name(b))landmarks.delete(id);}while(landmarks.size>256)landmarks.delete(landmarks.keys().next().value);
    const remaining=Object.fromEntries(Object.entries(goal).filter(([id,n])=>owned(o,id)<n).map(([id,n])=>[id,n-owned(o,id)]));state.remaining=remaining;
    if(!Object.keys(remaining).length&&maxExploredDistance>=exploreDistance)return null;
    if(o.self.health<=8){
      const portal=[...landmarks.values()].filter(b=>name(b)==='nether_portal').sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position))[0];
      return portal?{action:null,reason:"Critical health in Neser: Target suspended; Nutrition and protection have priority. Back portal saved."}:{action:null,reason:"Critical health in Neser: First to recover."};
    }
    if(!Object.keys(remaining).length){const decision=explore(o);return {...decision,reason:`Explore the observed Nether: ${maxExploredDistance.toFixed(1)} / ${exploreDistance} blocks from the entry point. ${decision.reason||''}`};}
    const piglins=(o.entities||[]).filter(e=>e.name==='piglin'&&distance(e.position,o.self.position)<24);
    if(!wearsGold(o.equipment)){
      const gold=Object.entries(o.inventory||{}).find(([id,n])=>n>0&&/^minecraft:golden_(boots|helmet|leggings|chestplate)$/.test(id));
      if(gold)return act('equipArmor',{item:gold[0]},"Put on the gold detail before contacting the piglins.",850);
      if(piglins.length)return supply({'minecraft:golden_boots':1},o);
    }
    for(const [item,mobs]of Object.entries({'minecraft:blaze_rod':['blaze'],'minecraft:ender_pearl':['enderman'],'minecraft:magma_cream':['magma_cube'],'minecraft:ghast_tear':['ghast'],'minecraft:wither_skeleton_skull':['wither_skeleton'],'minecraft:porkchop':['hoglin']}))if(remaining[item]){
      const r=hunt(o,item,mobs);if(r)return r;
      if(item==='minecraft:ender_pearl'&&barters<maxBarters&&wearsGold(o.equipment)&&owned(o,'minecraft:gold_ingot')){
        for(const target of piglins.filter(e=>e.isBaby===false&&!e.hostile).sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position))){const r=choose(act('barter',{entityId:target.id},"Exchange one slip; Pearls are counted only after rebound.",50));if(r)return r;}
      }
    }
    if(remaining['minecraft:nether_wart']){
      for(const b of o.world?.sampledBlocks||[])if(name(b)==='nether_wart'&&Number(b.properties?.age)===3){const r=choose(act('dig',{...b.position,block:'minecraft:nether_wart'},"Gather a mature hell of a potion."));if(r)return r;}
    }
    const specialty=new Set(['minecraft:blaze_rod','minecraft:ender_pearl','minecraft:magma_cream','minecraft:ghast_tear','minecraft:wither_skeleton_skull','minecraft:porkchop','minecraft:nether_wart']);
    const ordinary=Object.fromEntries(Object.entries(goal).filter(([id])=>remaining[id]&&!specialty.has(id)));
    if(Object.keys(ordinary).length){const r=supply(ordinary,o);if(r?.action)return r;}
    const preferred=[...landmarks.values()].filter(b=>remaining['minecraft:blaze_rod']||remaining['minecraft:nether_wart']?fortress.has(name(b)):remaining['minecraft:ender_pearl']?name(b)==='warped_nylium':false).sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position)).find(b=>distance(b.position,o.self.position)>6);
    if(preferred){
      // Use nearby standing cells, not the solid fortress brick as a walking goal.
      for(const dy of [1,0,-1,2])for(const [dx,dz]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){const p={x:preferred.position.x+dx,y:preferred.position.y+dy,z:preferred.position.z+dz};if(safeFeet(p)){const r=choose(act('navigate',{...p,range:0,bridge:false,maxDrop:2,sprintJump:false},"Check observed reference for the fortress or distorted forest."));if(r)return r;}}
    }
    return explore(o,preferred?.position);
  }
  const reactor={id:'overmind:nether',apiVersion:1,failureScope:'action',react(o){observation=o;activeResource=null;selected=null;const r=decide(o);state={...state,status:r?(r.action?'progressing':'blocked'):'completed',reason:r?.reason||"Neser's resources are confirmed by inventory.",barters,landmarks:[...landmarks.values()]};selected=r?.action;if(selected?.skill==='barter')barterBaseline=client.metrics?.barterGoldSpent||0;return r||{action:null,reason:state.reason};},recordResult(event,action=selected){
    activeResource?.recordResult?.(event,action);if(!action)return;
    if(action.skill==='barter'&&(event.outcome==='success'||(client.metrics?.barterGoldSpent||0)>barterBaseline))barters++;
    if(event.outcome==='cancelled')return;
    const id=JSON.stringify(action);if(event.outcome==='failure'){const attempts=(failures.get(id)?.attempts||0)+1;failures.set(id,{attempts,until:clock()+Math.min(120000,2000*2**Math.min(6,attempts)),dimension:observation.dimension,from:{...observation.self.position}});if(action.skill==='navigate'&&point(action.args)){visited.push(floor(action.args));if(visited.length>512)visited.shift();}explorationPlanner?.invalidate();}else failures.delete(id);while(failures.size>128)failures.delete(failures.keys().next().value);
  },snapshot:()=>structuredClone(state),exportMemory:()=>({schemaVersion:1,targets:{...goal},barters,landmarks:[...landmarks.values()],visited:[...visited],exploreDistance,startPosition:startPosition?{...startPosition}:null,maxExploredDistance})};
  if(memory){if(memory.schemaVersion!==1||JSON.stringify(memory.targets)!==JSON.stringify(goal)||!Number.isInteger(memory.barters)||memory.barters<0||memory.barters>4096||!Array.isArray(memory.landmarks)||memory.landmarks.length>256||!Array.isArray(memory.visited)||memory.visited.length>512||memory.landmarks.some(b=>!point(b.position)||!['nether_portal','warped_nylium',...fortress].includes(name(b)))||memory.visited.some(p=>!point(p)))throw new Error("Invalid Nether memory.");barters=memory.barters;for(const b of memory.landmarks)landmarks.set(key(b.position),structuredClone(b));visited.push(...structuredClone(memory.visited));}
  if(memory){if((memory.exploreDistance??0)!==exploreDistance||memory.startPosition!=null&&!point(memory.startPosition)||memory.maxExploredDistance!==undefined&&(!Number.isFinite(memory.maxExploredDistance)||memory.maxExploredDistance<0||memory.maxExploredDistance>100000000))throw new Error('Invalid Nether exploration memory.');startPosition=memory.startPosition?{...memory.startPosition}:null;maxExploredDistance=memory.maxExploredDistance??0;state.maxExploredDistance=maxExploredDistance;}
  return reactor;
}
