import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { planRouteAsync, readRouteWorld, isAir, isFullBlock, isHazard } from './navigation.js';
import { weaponProfile, chooseWeapon, combatDecision, shieldFaces } from './combat.js';
import { solveAim } from './projectiles.js';
import { miningTime, chooseMiningTool, remainingDurability } from './equipment.js';
import { isStorageBlock, storageIdentity } from './containers.js';
import { executeNavigate, combatControl, wrapDegrees, safeCorridor, routeCanDig } from './movement.js';
import { craft, ensureStation, smelt, smith } from './crafting.js';
import { prepareBed, sleep } from './rest.js';
import { ignitePortal, fillEndFrame, throwEye, enterPortal } from './portals.js';
import { pillar, descendPillar } from './pillar.js';
import { executeCollect } from './collection.js';
import {assertEdit, editDecision, rememberPlacement} from './protection.js';
import {CombatPursuit, combatApproach} from './combat-navigation.js';
import { executeSwim } from './swimming.js';
import { clickMenu } from './menus.js';
import { mountVehicle, dismountVehicle } from './transport.js';
import {inspectStorage,transferStorage} from './storage-actions.js';
import {labelStorage} from './signs.js';
import {executeFly} from './flight.js';
import {climbLadder} from './ladder.js';
import {bridgeTo} from './bridge.js';
import {predictFallLanding,planPearlEscape} from './fall-safety.js';
import {perchedDragonHead} from './dragon-melee.js';
import {executeCreativeFly} from './creative-flight.js';
import {barter} from './bartering.js';
import {planRetreatExcavation} from './retreat.js';
import {traceVisibility} from './visibility.js';
export { miningTime, chooseMiningTool } from './equipment.js';
export const OM_SKILLS = Object.freeze(['barter', 'creativeTake', 'creativeFly', 'potFlower', 'bridgeTo', 'climbLadder', 'fly', 'inspectStorage', 'takeStorage', 'depositStorage', 'labelStorage', 'swim', 'menuClick', 'mount', 'dismount', 'look', 'lookAtPlayer', 'lootChest', 'select', 'equipArmor', 'prepareBed', 'sleep', 'goto', 'navigate', 'pillar', 'descendPillar', 'evade', 'dig', 'gather', 'collect', 'place', 'craft', 'smith', 'ensureStation', 'smelt', 'attack', 'attackDragon', 'combat', 'guard', 'waterGuard', 'waterClutch', 'escapePearl', 'shoot', 'drop', 'eat', 'wait', 'ignitePortal', 'fillEndFrame', 'throwEye', 'enterPortal']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const center = p => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
const name = value => { if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error("Requires vanilla ID item/block."); return value.replace(/^minecraft:/, ''); };
const alive = (c, signal) => { signal.throwIfAborted(); if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error("Agent is unavailable."); };
function visible(c, target) {
  const start = { ...c.state.position, y: c.state.position.y + 1.62 }, d = distance(start, target), delta = { x: (target.x - start.x) / d, y: (target.y - start.y) / d, z: (target.z - start.z) / d };
  for (let t = 0; t < d - 0.3; t += 0.15) {
    const p = { x: start.x + delta.x * t, y: start.y + delta.y * t, z: start.z + delta.z * t }, b = c.world.blockAt(p);
    if (!b) return false;
    const x = p.x - Math.floor(p.x), y = p.y - Math.floor(p.y), z = p.z - Math.floor(p.z);
    if (b.shapes?.some(s => x > s[0] && x < s[3] && y > s[1] && y < s[4] && z > s[2] && z < s[5]) && distance(floor(p), floor(target)) > 0) return false;
  }
  return true;
}
function placementCursor(block,direction){
  const shapes=(block?.shapes||[]).filter(shape=>Array.isArray(shape)&&shape.length===6&&shape.every(Number.isFinite));
  if(!shapes.length)return {x:.5,y:.5,z:.5};
  const axis=[1,1,2,2,0,0][direction],edge=[1,4,2,5,0,3][direction],outward=[0,2,4].includes(direction)?Math.min:Math.max;
  const limit=outward(...shapes.map(shape=>shape[edge]));
  const touching=shapes.filter(shape=>Math.abs(shape[edge]-limit)<.001);
  const area=shape=>axis===0?(shape[4]-shape[1])*(shape[5]-shape[2]):axis===1?(shape[3]-shape[0])*(shape[5]-shape[2]):(shape[3]-shape[0])*(shape[4]-shape[1]);
  const selected=touching.sort((a,b)=>area(b)-area(a))[0];
  const cursor={x:(selected[0]+selected[3])/2,y:(selected[1]+selected[4])/2,z:(selected[2]+selected[5])/2};
  cursor[['y','y','z','z','x','x'][direction]]=limit;
  return cursor;
}
async function select(c, itemName, signal) {
  alive(c, signal);
  if (c.containers.current || c.inventory.cursor) throw new Error("Before changing items, close the window and clear the cursor.");
  const item = typeof itemName === 'object' ? c.inventory.slots[itemName.slot] : c.inventory.items().find(i => i.name === name(itemName));
  if (!item || typeof itemName === 'object' && item.type !== itemName.type) throw new Error("The selected item is missing or changed.");
  if (item.slot >= 36 && item.slot <= 44) {
    if (c.inventory.selected !== item.slot - 36) c.nextAttackAt = performance.now() + weaponProfile(item.name).cooldownMs;
    c.inventory.selected = item.slot - 36; c.write('held_item_slot', { slotId: c.inventory.selected }); return item;
  }
  const targetSlot = 36 + c.inventory.selected, previous = c.inventory.held(), revision = c.inventory.revision;
  c.write('window_click', { windowId: 0, stateId: c.inventory.stateId, slot: item.slot, mouseButton: c.inventory.selected, mode: 2, changedSlots: [], cursorItem: c.inventory.cursor?.raw || { itemCount: 0 } });
  const same = (a, b) => JSON.stringify(a?.raw ?? null) === JSON.stringify(b?.raw ?? null);
  await c.waitFor(() => c.inventory.revision > revision && same(c.inventory.slots[targetSlot], item) && same(c.inventory.slots[item.slot], previous), { event: 'inventory', signal, timeoutMs: 3000 });
  c.nextAttackAt = performance.now() + weaponProfile(item.name).cooldownMs;
  return c.inventory.held();
}
async function navigate(c, args, signal) {
  return executeNavigate(c, args, signal, { place: (args, signal) => runAction(c, { skill: 'place', args }, signal), dig: (step, signal) => dig(c, { ...step, preservePickaxeTier:args.preservePickaxeTier }, signal) });
}
async function emptyHand(c, signal) {
  if (!c.inventory.held()) return;
  const empty = Array.from({ length: 36 }, (_, i) => 9 + i).filter(i => !c.inventory.slots[i]).sort((a,b) => Number(b >= 36) - Number(a >= 36))[0];
  if (empty === undefined) throw new Error("You need a free slot to fight; Items not automatically discarded.");
  if (empty >= 36) { c.inventory.selected = empty - 36; c.write('held_item_slot', { slotId: c.inventory.selected }); }
  else {
    const revision = c.inventory.revision, heldSlot = 36 + c.inventory.selected;
    c.write('window_click', { windowId: 0, stateId: c.inventory.stateId, slot: empty, mouseButton: c.inventory.selected, mode: 2, changedSlots: [], cursorItem: { itemCount: 0 } });
    await c.waitFor(() => c.inventory.revision > revision && !c.inventory.slots[heldSlot], { signal, event: 'inventory', timeoutMs: 3000 });
  }
  c.nextAttackAt = performance.now() + 250;
}
async function approach(c, position, signal, {forPlacement=false,preferFlight=false,preferBelow=false}={}) {
  const aim = center(position), eye = () => ({ ...c.state.position, y: c.state.position.y + 1.62 });
  const occupying=()=>forPlacement&&Math.abs(c.state.position.x-aim.x)<.8&&Math.abs(c.state.position.z-aim.z)<.8&&position.y>=Math.floor(c.state.position.y)&&position.y<=Math.floor(c.state.position.y)+1;
  if (!occupying()&&distance(eye(), aim) <= 4.3 && visible(c, aim)&&(!preferFlight||c.state.creativeFlying)&&(!preferBelow||eye().y<aim.y)) return;
  if(forPlacement&&c.state.gameMode==='creative'&&c.state.allowFlying){
    const hover=[];
    for(const dy of [-2,-1,0,1,2,3])for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      if(!dx&&!dz)continue;
      const p={x:position.x+dx,y:position.y+dy,z:position.z+dz};
      if(distance({x:p.x+.5,y:p.y+1.62,z:p.z+.5},aim)>4.3)continue;
      if(isAir(c.world.blockAt(p))&&isAir(c.world.blockAt({...p,y:p.y+1})))hover.push(p);
    }
    const score=p=>Math.abs((p.y-position.y)-(preferBelow?-2:2))*1.5+distance(p,c.state.position);
    hover.sort((a,b)=>score(a)-score(b));
    for(const p of hover.slice(0,12)){
      try{await executeCreativeFly(c,{...p,land:false,direct:true,pathfind:true},signal);}catch(error){signal.throwIfAborted();continue;}
      if(!occupying()&&distance(eye(),aim)<=4.3&&visible(c,aim))return;
    }
  }
  const candidates = [];
  for (let dy = -4; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const p = { x: position.x + dx, y: position.y + dy, z: position.z + dz };
    if(forPlacement&&p.x===position.x&&p.z===position.z&&Math.abs(p.y-position.y)<2)continue;
    if (distance({x:p.x+.5,y:p.y+1.62,z:p.z+.5},aim)>4.3) continue;
    if (isAir(c.world.blockAt(p)) && isAir(c.world.blockAt({ ...p, y: p.y + 1 })) && isFullBlock(c.world.blockAt({ ...p, y: p.y - 1 }))) candidates.push(p);
  }
  candidates.sort((a, b) => distance(a, c.state.position) - distance(b, c.state.position));
  const maxDrop=c.options?.maxDrop??(c.state.dimension==='minecraft:overworld'?16:3);
  const fallPolicy={health:c.state.health,minHealthAfter:c.options?.fallHealthReserve??6,maxDamage:c.options?.maxFallDamage??6};
  let lastError;
  for (const excavate of forPlacement?[false]:[false,true]) for (const p of candidates.slice(0, 24)) {
    const view = readRouteWorld(c.world);
    const route = await planRouteAsync({ start: floor(c.state.position), goal: p, getBlock: view.getBlock, canDig:excavate?routeCanDig(c):()=>false, maxNodes: 3000, maxDistance: 128, maxDrop,fallPolicy,signal }, { getRevision: view.getRevision });
    if (route.status !== 'planned') continue;
    try { await navigate(c, { ...p, range: 0, excavate, maxDrop, bridge:false }, signal); }
    catch(error) { signal.throwIfAborted(); lastError=error; continue; }
    if (!occupying()&&distance(eye(), aim) <= 4.3 && visible(c, aim)) return;
  }
  throw lastError || new Error("No reachable position with line of sight to the target block.");
}
async function dig(c, args, signal) {
  if (!point(args)) throw new Error("dig: Need coordinates.");
  const position = floor(args); assertEdit(c,'dig',position); await approach(c, position, signal); alive(c, signal);
  const b = c.world.blockAt(position); if (!b || args.block && name(args.block) !== b.name) throw new Error("Target block missing or changed.");
  const foot = floor(c.state.position);
  if (position.x === foot.x && position.z === foot.z && position.y < foot.y) throw new Error("Mining prohibited.");
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const adjacent = c.world.blockAt({ x: position.x + dx, y: position.y + dy, z: position.z + dz });
    if (!adjacent || isHazard(adjacent) || dy === 1 && ['sand', 'gravel', 'anvil', 'pointed_dripstone'].includes(adjacent.name)) throw new Error("Liquid close by, Falling block or unknown area.");
  }
  const tool = chooseMiningTool(c.registry, b, c.inventory.items(), { held: c.inventory.held(), onGround: c.state.onGround, preservePickaxeTier:args.preservePickaxeTier });
  if (!tool) throw new Error("No tool capable of harvesting the drop.");
  if (tool.item && tool.item.slot !== c.inventory.held()?.slot) await select(c, tool.item, signal);
  if (!tool.item) await emptyHand(c, signal);
  const timing = miningTime(c.registry, b, c.inventory.held(), { onGround: c.state.onGround });
  if (!timing.harvestable) throw new Error("No tool capable of harvesting the drop.");
  if (timing.milliseconds > 30000) throw new Error("Mining would take too long without a suitable tool.");
  c.lookAt(center(position)); await c.waitForLook?.({ signal }); const original = b.stateId, face = 1; let complete = false;
  const started = performance.now();
  assertEdit(c,'dig',position);
  if (c.world.stateAt(position) !== original) throw new Error("The target block changed during the preparation of the mine.");
  c.write('block_dig', { status: 0, location: position, face, sequence: ++c.sequence });
  // The server tracks the break separately; arm swings are client-driven and must
  // continue during long digs so other players see an actual mining motion.
  c.write('arm_animation', { hand: 0 });
  const swingTimer=setInterval(()=>{
    if(c.client?.state==='play'&&!signal.aborted&&c.state.status==='ready')c.write('arm_animation',{hand:0});
  },250);
  try {
    await delay(timing.milliseconds, undefined, { signal }); alive(c, signal);
    assertEdit(c,'dig',position);
    if (c.world.stateAt(position) !== original) throw new Error("The target block changed during mining.");
    c.write('block_dig', { status: 2, location: position, face, sequence: ++c.sequence });
    await c.waitFor(() => c.world.stateAt(position) !== null && c.world.stateAt(position) !== original, { event: 'block', signal, timeoutMs: 3000 }); complete = true;
    return { ok: true, position, block: b.name, serverConfirmed: true, durationMs: performance.now() - started };
  } finally { clearInterval(swingTimer);if (!complete && c.client.state === 'play') c.write('block_dig', { status: 1, location: position, face, sequence: ++c.sequence }); }
}
async function collect(c, args, signal) {
  return executeCollect(c, args, signal, { navigate });
}
export async function runAction(c, action, signal) {
  const { skill, args = {} } = action;
  if (!OM_SKILLS.includes(skill)) throw new Error(`OMConnect Not yet implemented ${skill}.`);
  alive(c, signal);
  if(skill==='creativeFly')return executeCreativeFly(c,args,signal);
  if(skill==='creativeTake'){
    if(c.state.gameMode!=='creative')throw new Error("creativeTake available only in Creative.");
    const itemName=name(args.item),record=c.registry.itemsByName[itemName],count=args.count??Math.min(64,record?.stackSize||64);
    if(!record||!Number.isInteger(count)||count<1||count>Math.min(64,record.stackSize||64))throw new Error("creativeTake: existing item and permissible quantity.");
    const slot=Number.isInteger(args.slot)?args.slot:36+c.inventory.selected;
    if(slot<36||slot>44)throw new Error("creativeTake: Quick access panel slot only 36–44.");
    if(c.inventory.slots[slot]&&!args.replace)throw new Error("Slot is busy; For replacement, indicate replace:true.");
    const properties=args.properties||{};
    if(!properties||typeof properties!=='object'||Array.isArray(properties)||Object.entries(properties).some(([key,value])=>!/^\w{1,64}$/.test(key)||typeof value!=='string'||!/^\w{1,64}$/.test(value)))throw new Error("creativeTake: Incorrect properties of the block.");
    const components=Object.keys(properties).length?[{type:'block_state',data:{properties:Object.entries(properties).map(([property,value])=>({property,value}))}}]:[];
    const current=c.inventory.slots[slot],currentProperties=Object.fromEntries(current?.raw?.components?.find(component=>component.type==='block_state')?.data?.properties?.map(({property,value})=>[property,value])||[]);
    if(current?.name===itemName&&current.count===count&&Object.keys(currentProperties).length===Object.keys(properties).length&&Object.entries(properties).every(([key,value])=>currentProperties[key]===value))return {ok:true,serverConfirmed:true,alreadyHeld:true,slot,item:'minecraft:'+itemName,count,properties};
    const revision=c.inventory.revision;
    c.write('set_creative_slot',{slot,item:{itemCount:count,itemId:record.id,addedComponentCount:components.length,removedComponentCount:0,components,removeComponents:[]}});
    await c.waitFor(()=>c.inventory.revision>revision&&c.inventory.slots[slot]?.name===itemName&&c.inventory.slots[slot]?.count===count,{event:'inventory',signal,timeoutMs:3000});
    return {ok:true,serverConfirmed:true,slot,item:'minecraft:'+itemName,count,properties};
  }
  if(skill==='potFlower'){
    if(!point(args)||!['pink_tulip','blue_orchid','cornflower','dandelion','poppy','azure_bluet','red_tulip','orange_tulip','white_tulip','oxeye_daisy','lily_of_the_valley','wither_rose'].includes(args.flower))throw new Error("potFlower: coordinates of pot and supported flower.");
    const p=floor(args);await approach(c,p,signal);
    if(c.world.blockAt(p)?.name!=='flower_pot')throw new Error("There's no empty pot in the chosen location.");
    await select(c,args.flower,signal);c.lookAt(center(p));await c.waitForLook?.({signal});
    c.write('block_place',{hand:0,location:p,direction:1,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
    await c.waitFor(()=>c.world.blockAt(p)?.name==='potted_'+args.flower,{signal,event:'block',timeoutMs:3000});
    return {ok:true,serverConfirmed:true,position:p,flower:args.flower};
  }
  if (skill === 'swim') return executeSwim(c,args,signal);
  if(skill==='climbLadder')return climbLadder(c,args,signal,{navigate});
  if(skill==='bridgeTo')return bridgeTo(c,args,signal,{run:runAction});
  if(skill==='fly')return executeFly(c,args,signal,{run:runAction,select});
  if(skill==='inspectStorage')return inspectStorage(c,args,signal,{approach});
  if(skill==='takeStorage'||skill==='depositStorage')return transferStorage(c,args,signal,{approach},skill==='takeStorage'?'take':'deposit');
  if(skill==='labelStorage')return labelStorage(c,args,signal,{approach,select});
  if (skill === 'menuClick') return clickMenu(c,args,signal);
  if (skill === 'mount') return mountVehicle(c,args,signal);
  if (skill === 'dismount') return dismountVehicle(c,signal);
  if (['ignitePortal','fillEndFrame','throwEye','enterPortal'].includes(skill)) return ({ignitePortal,fillEndFrame,throwEye,enterPortal})[skill](c,args,signal,{run:runAction,approach,select});
  if (skill === 'pillar') return pillar(c,args,signal,{select});
  if (skill === 'descendPillar') return descendPillar(c,args,signal,{select});
  if (skill === 'evade') {
    if (!point(args.from)) throw new Error("evade.from: Need a known point of danger.");
    const here=floor(c.state.position), candidates=[];
    const localRetreat=async()=>{
      const control=combatControl(c.state,args.from,'retreat',p=>c.world.blockAt(p));
      if(Math.hypot(control.x,control.z)<=.1)return null;
      const direction={x:control.x,z:control.z};
      const long=safeCorridor(c.state.position,direction,4,p=>c.world.blockAt(p));
      const medium=long||safeCorridor(c.state.position,direction,2.5,p=>c.world.blockAt(p));
      c.control={...control,sprint:medium,jump:false};
      try{await delay(long?400:medium?250:150,undefined,{signal});}finally{c.stopMovement();}
      return {ok:true,emergencyStep:true};
    };
    const threat=c.entities.get(Number(args.entityId));
    if(distance(c.state.position,args.from)<4.5||threat?.name==='creeper'&&distance(c.state.position,args.from)<6){const immediate=await localRetreat();if(immediate)return immediate;}
    for(let dx=-6;dx<=6;dx++)for(let dz=-6;dz<=6;dz++) {
      const p={x:here.x+dx,y:here.y,z:here.z+dz};
      if (Math.hypot(dx,dz)<3 || distance(p,args.from)<distance(here,args.from)+2) continue;
      if ([...c.entities.values()].some(e=>e.name==='end_crystal' && distance(p,e.position)<12 || e.name==='area_effect_cloud' && distance(p,e.position)<(e.metadata?.radius||3)+2)) continue;
      if(isAir(c.world.blockAt(p))&&isAir(c.world.blockAt({...p,y:p.y+1}))&&isFullBlock(c.world.blockAt({...p,y:p.y-1}))) candidates.push(p);
    }
    const coverCache=new Map();
    const covered=p=>{const id=`${p.x},${p.y},${p.z}`;if(!coverCache.has(id))coverCache.set(id,traceVisibility({origin:{...args.from,y:args.from.y+1.5},target:{...p,x:p.x+.5,y:p.y+1.3,z:p.z+.5},getBlock:q=>c.world.blockAt(q),maxDistance:32}).reason==='blocked');return coverCache.get(id);};
    candidates.sort((a,b)=>(args.seekCover===true?Number(covered(b))-Number(covered(a)):0)||distance(b,args.from)-distance(a,args.from));
    for(const p of candidates.slice(0,24)) {
      const view = readRouteWorld(c.world);
      if((await planRouteAsync({start:here,goal:p,getBlock:view.getBlock,maxNodes:1000,maxDistance:12,maxDrop:1,signal}, {getRevision:view.getRevision})).status==='planned') return navigate(c,{...p,range:0,bridge:false,sprintJump:false,maxDrop:1},signal);
    }
    if(args.digEscape!==false){const escape=planRetreatExcavation({position:c.state.position,from:args.from,getBlock:p=>c.world.blockAt(p),canDig:routeCanDig(c),miningMs:b=>{const tool=chooseMiningTool(c.registry,b,c.inventory.items(),{held:c.inventory.held(),onGround:c.state.onGround});return tool?.milliseconds??Infinity;}});
      if(escape){for(const p of escape.dig){signal.throwIfAborted();const hostile=c.entities.get(Number(args.entityId));if(hostile&&distance(c.state.position,hostile.position)<3.5)throw new Error("The threat is coming: Dumping of the waste has been stopped.");await runAction(c,{skill:'dig',args:{...p}},signal);}return navigate(c,{...escape.position,range:0,bridge:false,maxDrop:1},signal);}}
    // In a narrow excavation a full three-block escape may not exist yet.
    // Take one verified local step, then let the brain re-evaluate the threat.
    const fallback=await localRetreat();if(fallback)return fallback;
    throw new Error("No known safe route found.");
  }
  if(skill==='equipArmor'){
    const itemName=name(args.item),part=itemName==='elytra'?1:['helmet','chestplate','leggings','boots'].findIndex(s=>itemName.endsWith('_'+s));
    if(part<0||!c.registry.itemsByName[itemName])throw new Error("equipArmor: I need a armored object.");
    const slot=5+part,old=c.inventory.slots[slot];
    if(old?.name===itemName)return {ok:true,serverConfirmed:true,slot,item:itemName,alreadyEquipped:true};
    await select(c,itemName,signal);const item=c.inventory.held(),revision=c.inventory.revision,heldSlot=36+c.inventory.selected;
    c.write('window_click',{windowId:0,stateId:-1,slot,mouseButton:c.inventory.selected,mode:2,changedSlots:[],cursorItem:{itemCount:0}});
    const same=(a,b)=>JSON.stringify(a?.raw??null)===JSON.stringify(b?.raw??null);
    await c.waitFor(()=>c.inventory.revision>revision&&same(c.inventory.slots[slot],item)&&same(c.inventory.slots[heldSlot],old),{signal,event:'inventory',timeoutMs:3000});
    return {ok:true,serverConfirmed:true,slot,item:itemName};
  }
  if (skill === 'look') { if (!point(args)) throw new Error('look: x/y/z.'); c.lookAt(args); await c.waitForLook?.({ signal }); return { ok: true }; }
  if (skill === 'craft') return craft(c, args, signal, { run: runAction, approach });
  if (skill === 'barter') return barter(c,args,signal,{select,run:runAction});
  if (skill === 'smith') return smith(c, args, signal, { run: runAction, approach });
  if (skill === 'ensureStation') return ensureStation(c, args, signal, { run: runAction, approach });
  if (skill === 'smelt') return smelt(c, args, signal, { run: runAction, approach });
  if (skill === 'prepareBed') return prepareBed(c,args,signal,{run:runAction,approach});
  if (skill === 'sleep') return sleep(c,args,signal,{run:runAction,approach});
  if (skill === 'lookAtPlayer') {
    const durationMs = args.durationMs ?? 1000;
    if (typeof args.username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(args.username) || !Number.isInteger(durationMs) || durationMs < 50 || durationMs > 30000) throw new Error("lookAtPlayer: username and durationMs 50–30000.");
    const first = c.players.entity(args.username); if (!first) throw new Error("Player's position unknown.");
    const uuid = first.uuid, until = Date.now() + durationMs;
    while (Date.now() < until) {
      alive(c, signal); const e = c.players.entity(uuid);
      if (!e || distance(e.position, c.state.position) > 32 || !visible(c, { ...e.position, y: e.position.y + e.eyeHeight })) throw new Error("The player disappeared, too far or hidden by the barrier.");
      c.lookAt({ ...e.position, y: e.position.y + e.eyeHeight }); await delay(50, undefined, { signal });
    }
    return { ok: true, observedPlayer: args.username, uuid, rotationSent: true };
  }
  if (skill === 'select') { await select(c, args.item, signal); return { ok: true, selected: c.inventory.selected }; }
  if (skill === 'shoot') return shoot(c, args, signal);
  if (skill === 'lootChest') return lootChest(c, args, signal);
  if (skill === 'drop') {
    const count = args.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 64 || c.inventory.count(name(args.item)) < count) throw new Error("drop: requires 1–64 available subject matter.");
    const initial = c.inventory.count(name(args.item));
    for (let i = 0; i < count; i++) {
      await select(c, args.item, signal); const before = c.inventory.count(name(args.item));
      c.write('block_dig', { status: 4, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence });
      // Vanilla may assume the client already applied a drop. An empty outside click
      // with a mismatching state requests a full authoritative inventory without moving items.
      c.write('window_click', {windowId:0,stateId:-1,slot:-999,mouseButton:0,mode:0,changedSlots:[],cursorItem:{itemCount:0}});
      await c.waitFor(() => c.inventory.count(name(args.item)) < before, { event: 'inventory', signal, timeoutMs: 3000 });
    }
    return { ok: true, serverConfirmed: true, lost: initial - c.inventory.count(name(args.item)) };
  }
  if (skill === 'eat') {
    const food = c.registry.foodsByName?.[name(args.item)];
    const special=['golden_apple','enchanted_golden_apple'];
    if (!food || c.state.food >= 20 && !special.includes(name(args.item))) throw new Error("eat: You need a edible object and incompleteness.");
    await select(c, args.item, signal); const before = c.inventory.count(name(args.item)), hunger = c.state.food;
    c.write('use_item', { hand: 0, sequence: ++c.sequence, rotation: { x: c.state.yaw, y: c.state.pitch } });
    try {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) { alive(c, signal); if (c.inventory.count(name(args.item)) < before && (c.state.food > hunger || special.includes(name(args.item)))) return { ok: true, serverConfirmed: true }; await delay(25, undefined, { signal }); }
      throw new Error("The server did not confirm the consumption of food and the change in the level of food.");
    } finally { if (c.client.state === 'play') c.write('block_dig', { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence }); }
  }
  if (['goto', 'navigate'].includes(skill)) return navigate(c, args, signal);
  if (skill === 'dig') return dig(c, args, signal);
  if (skill === 'collect') return collect(c, args, signal);
  if (skill === 'gather') {
    const selectors = args.block || '#logs', names = c.world.resolveSelectors([selectors]), count = args.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 16 || !names.length) throw new Error("gather: ♪ In the empty class ♪ count 1–16.");
    const results = [];
    for (let i = 0; i < count; i++) {
      const found = await c.world.findBlocks({ names, position: c.state.position, radius: 64, count: 16, signal });
      let block, lastError;
      for (const candidate of found.blocks.filter(b=>editDecision(c,'dig',b.position).allowed)) {
        try { await approach(c, candidate.position, signal); block = candidate; break; } catch (e) { signal.throwIfAborted(); lastError = e; }
      }
      if (!block) throw lastError || new Error(`No achievable block ${selectors}.`);
      const data = c.registry.blocksByName[block.name.slice(10)], expected = args.item ? name(args.item) : c.registry.items[data.drops?.[0]]?.name;
      if (!expected) throw new Error("For this block, indicate what you expect item.");
      const before = c.inventory.count(expected);
      const result = await dig(c, { ...block.position, block: block.name }, signal);
      const pickup = await collect(c, { item: expected, beforeCount: before, origin: block.position }, signal);
      results.push({ ...result, ...pickup });
    }
    return { ok: true, blocks: results };
  }
  if (skill === 'place') {
    if (!point(args)) throw new Error("place: coordinates.");
    const p = floor(args), blockName = name(args.block); assertEdit(c,'place',p); await approach(c, p, signal,{forPlacement:true,preferFlight:Boolean(args.preferFlight),preferBelow:blockName.endsWith('_trapdoor')||blockName==='lantern'&&args.properties?.hanging==='true'});
    if (!isAir(c.world.blockAt(p))) throw new Error("Position occupied.");
    const faces = [[0, -1, 0, 1], [0, 1, 0, 0], [0, 0, -1, 3], [0, 0, 1, 2], [-1, 0, 0, 5], [1, 0, 0, 4]];
    if(blockName==='lantern'&&args.properties?.hanging==='true')faces.unshift(faces.splice(1,1)[0]);
    const anchor=block=>block&&block.name!=='air'&&block.boundingBox!=='empty';
    const hanging=blockName==='lantern'&&args.properties?.hanging==='true';
    const face=hanging&&anchor(c.world.blockAt({...p,y:p.y+1}))?faces[0]:faces.find(([x,y,z])=>isFullBlock(c.world.blockAt({x:p.x+x,y:p.y+y,z:p.z+z})))||faces.find(([x,y,z])=>anchor(c.world.blockAt({x:p.x+x,y:p.y+y,z:p.z+z})));
    if (!face) throw new Error("No observed support edge.");
    const held=args.itemSlot===undefined?blockName:{slot:args.itemSlot,type:c.inventory.slots[args.itemSlot]?.type};
    await select(c, held, signal); const ref = { x: p.x + face[0], y: p.y + face[1], z: p.z + face[2] };
    const cursor=placementCursor(c.world.blockAt(ref),face[3]);
    c.lookAt({x:ref.x+cursor.x,y:ref.y+cursor.y,z:ref.z+cursor.z},args.fastPlacement&&c.state.gameMode==='creative'?{signal,immediate:true}:{signal});
    if(!args.fastPlacement||c.state.gameMode!=='creative')await c.waitForLook?.({signal});
    assertEdit(c,'place',p);
    if (!isAir(c.world.blockAt(p)) || !anchor(c.world.blockAt(ref))) throw new Error("Position or support changed during rotation.");
    if(c.listenerCount?.('placementAttempt'))c.emit('placementAttempt',{target:p,reference:ref,direction:face[3],cursor,position:{...c.state.position},support:c.world.blockAt(ref)?.name});
    c.write('block_place', { hand: 0, location: ref, direction: face[3], cursorX: cursor.x, cursorY: cursor.y, cursorZ: cursor.z, insideBlock: false, sequence: ++c.sequence });
    await c.waitFor(() => c.world.blockAt(p)?.name === blockName, { signal, event: 'block', timeoutMs: 3000 });
    if(args.properties&&Object.entries(args.properties).some(([key,value])=>String(c.world.blockAt(p)?.getProperties?.()[key])!==value))throw new Error(`Status ${blockName} After installation did not coincide with the pattern.`);
    rememberPlacement(c,p); return { ok: true, serverConfirmed: true };
  }
  if (skill === 'attack') {
    const e = c.entities.get(Number(args.entityId)); if (!e || e.kind === 'player' && args.allowPlayer !== true) throw new Error("Unaffordable Target; PvP requires allowPlayer.");
    if (distance(e.position, c.state.position) > 3 || !visible(c, { ...e.position, y: e.position.y + 0.8 })) throw new Error("Target outside impact distance or behind the barrier.");
    if (performance.now() < (c.nextAttackAt || 0)) throw new Error("Weapons are still recovering.");
    c.lookAt({ ...e.position, y: e.position.y + 0.8 },{signal,turnSpeed:720}); await c.waitForLook?.({ signal }); const at = performance.now();
    if(c.entities.get(Number(e.id))!==e||distance(e.position,c.state.position)>3||!visible(c,{...e.position,y:e.position.y+.8})){const error=new Error("Target moved while aiming; a new approach is required.");error.code='KUDO_TARGET_MOVED';throw error;}
    c.write('use_entity', { target: Number(e.id), mouse: 1, sneaking: false }); c.write('arm_animation', { hand: 0 });
    c.emit?.('attackSent',{entityId:String(e.id),name:e.name,weapon:c.inventory.held()?.name||'hand',at:Date.now()});
    c.nextAttackAt = at + weaponProfile(c.inventory.held()?.name).cooldownMs;
    return { ok: true, sent: true, damageConfirmed: false, dispatchMs: performance.now() - at };
  }
  if (skill === 'attackDragon') {
    const dragon=c.entities.get(Number(args.entityId));
    if(dragon?.name!=='ender_dragon'||![5,6,7].includes(dragon.metadata?.phase))throw new Error("The dragon isn't sitting by the portal.");
    if(!c.inventory.count('netherite_sword')&&!c.inventory.count('diamond_sword')&&!c.inventory.count('iron_sword'))throw new Error("The sword is for the next fight.");
    const sword=['netherite_sword','diamond_sword','iron_sword'].find(item=>c.inventory.count(item));
    c.stopMovement();await select(c,sword,signal);
    const head=()=>perchedDragonHead(dragon),withinReach=()=>{
      const p=head(),eye={...c.state.position,y:c.state.position.y+1.62};
      return p&&distance(eye,p)<3&&visible(c,p);
    };
    if(!withinReach())throw new Error("Dragon Head outside the confirmed sword distance.");
    while(performance.now()<(c.nextAttackAt||0)){alive(c,signal);await delay(25,undefined,{signal});}
    let criticalAttempted=false;
    if(args.critical!==false&&c.state.health>12&&c.state.food>6&&c.state.onGround&&isAir(c.world.blockAt({...floor(c.state.position),y:Math.floor(c.state.position.y)+2}))){
      c.control={x:0,z:0,jump:true,sprint:false,sneak:false};
      try{await delay(75,undefined,{signal});}finally{c.control={x:0,z:0,jump:false,sprint:false,sneak:false};}
      try{await c.waitFor(()=>!c.state.onGround&&c.state.velocity.y<-.02,{signal,event:'physics',timeoutMs:650});criticalAttempted=true;}catch{criticalAttempted=false;}
    }
    alive(c,signal);
    if(![5,6,7].includes(dragon.metadata?.phase)||!withinReach())throw new Error("Head position changed before impact.");
    const target=head(),before=dragon.metadata?.health??null,hits=c.endgame.ownDragonHits||0;
    c.lookAt(target,{signal,immediate:true});
    // The server allocates dragon part IDs directly after the parent ID; head is first.
    const headId=Number(dragon.id)+1;
    if(c.entities.has(headId))throw new Error("ID The head matches another entity.");
    c.write('use_entity',{target:headId,mouse:1,sneaking:false});c.write('arm_animation',{hand:0});
    c.nextAttackAt=performance.now()+weaponProfile(sword).cooldownMs;
    try{await c.waitFor(()=>c.endgame.ownDragonHits>hits||before!==null&&(dragon.metadata?.health??before)<before,{signal,event:'entity',timeoutMs:700});}catch{}
    return {ok:true,sent:true,criticalAttempted,damageConfirmed:(c.endgame.ownDragonHits||0)>hits||before!==null&&(dragon.metadata?.health??before)<before,headId};
  }
  if (skill === 'waterGuard') {
    if(c.state.dimension==='minecraft:the_nether')throw new Error("Water evaporates in the Nether; waterGuard unavailable.");
    const foot=floor(c.state.position),below={...foot,y:foot.y-1};
    if(c.world.blockAt(foot)?.name==='water')return {ok:true,alreadyProtected:true};
    if(!c.inventory.count('water_bucket'))throw new Error("No bucket of water to protect against enderman.");
    if(!isAir(c.world.blockAt(foot))||!isFullBlock(c.world.blockAt(below)))throw new Error("No safe water spilling support.");
    assertEdit(c,'place',foot);c.stopMovement();await select(c,'water_bucket',signal);
    c.lookAt(center(below));await c.waitForLook?.({signal});
    if(!isAir(c.world.blockAt(foot))||!isFullBlock(c.world.blockAt(below)))throw new Error("The base changed during the preparation of the water.");
    c.write('block_place',{hand:0,location:below,direction:1,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
    await c.waitFor(()=>c.world.blockAt(foot)?.name==='water',{signal,event:'block',timeoutMs:3000});
    return {ok:true,serverConfirmed:true,position:foot};
  }
  if (skill === 'escapePearl') {
    if(!c.inventory.count('ender_pearl'))throw new Error("No Kreyle pearls for emergency throw.");
    c.stopMovement();await select(c,'ender_pearl',signal);
    const plan=planPearlEscape(c.state,p=>c.world.blockAt(p),{endermen:c.entities.values()});
    if(!plan)throw new Error("No confirmed wide area for safe throwing of pearls.");
    const yaw=plan.yaw*Math.PI/180,pitch=plan.pitch*Math.PI/180,s=c.state.position;
    c.lookAt({x:s.x-Math.sin(yaw)*Math.cos(pitch)*20,y:s.y+1.62-Math.sin(pitch)*20,z:s.z+Math.cos(yaw)*Math.cos(pitch)*20},{signal,immediate:true});
    if(Math.hypot(wrapDegrees(c.state.yaw-plan.yaw),c.state.pitch-plan.pitch)>1)throw new Error("Dropped: The look has become unsafe.");
    const before=c.inventory.count('ender_pearl');
    c.write('use_item',{hand:0,sequence:++c.sequence,rotation:{x:c.state.yaw,y:c.state.pitch}});
    await c.waitFor(()=>c.inventory.count('ender_pearl')<before,{signal,event:'inventory',timeoutMs:1500});
    return {ok:true,serverConfirmed:true,thrown:true,landingConfirmed:false,plan};
  }
  if (skill === 'waterClutch') {
    if(c.state.dimension==='minecraft:the_nether')throw new Error("Water evaporates in the Nether; waterClutch unavailable.");
    if(!c.inventory.count('water_bucket'))throw new Error("No water bucket for fall insurance.");
    c.stopMovement();await select(c,'water_bucket',signal);
    const until=Date.now()+5000;
    while(Date.now()<until){
      alive(c,signal);
      if(c.state.onGround)return {ok:true,alreadyLanded:true,waterPlaced:false};
      const landing=predictFallLanding(c.state,p=>c.world.blockAt(p));
      if(!landing){if(c.inventory.count('ender_pearl'))return runAction(c,{skill:'escapePearl',args:{}},signal);throw new Error("The surface disappeared from the projection.");}
      const foot={...landing.support,y:landing.support.y+1};
      if(c.world.blockAt(foot)?.name==='water')return {ok:true,waterPlaced:true,recovered:false};
      if(!isAir(c.world.blockAt(foot))||!isFullBlock(c.world.blockAt(landing.support)))throw new Error("The projected water support has changed.");
      if(distance({...c.state.position,y:c.state.position.y+1.62},{x:foot.x+.5,y:foot.y,z:foot.z+.5})<=4.25){
        assertEdit(c,'place',foot);
        c.lookAt({x:foot.x+.5,y:foot.y,z:foot.z+.5},{signal,immediate:true});
        c.write('block_place',{hand:0,location:landing.support,direction:1,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
        await c.waitFor(()=>c.world.blockAt(foot)?.name==='water',{signal,event:'block',timeoutMs:1000});
        try{await c.waitFor(()=>c.state.onGround,{signal,event:'physics',timeoutMs:4000});}catch{return {ok:true,waterPlaced:true,recovered:false};}
        if(!c.inventory.count('bucket')||c.world.blockAt(foot)?.name!=='water')return {ok:true,waterPlaced:true,recovered:false};
        try{
          await select(c,'bucket',signal);const before=c.inventory.count('water_bucket');c.lookAt({x:foot.x+.5,y:foot.y+.5,z:foot.z+.5},{signal,immediate:true});
          c.write('block_place',{hand:0,location:foot,direction:1,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
          await c.waitFor(()=>c.inventory.count('water_bucket')>before,{signal,event:'inventory',timeoutMs:1000});
          return {ok:true,waterPlaced:true,recovered:true};
        }catch{return {ok:true,waterPlaced:true,recovered:false};}
      }
      await delay(25,undefined,{signal});
    }
    throw new Error("The emergency water installation budget has expired.");
  }
  if (skill === 'combat') {
    const duration = args.durationMs ?? 400, maxDistance = args.maxDistance ?? 12;
    if (!Number.isInteger(duration) || duration < 50 || duration > 2000 || !Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 32) throw new Error("combat: Wrong budget.");
    const target = c.entities.get(Number(args.entityId));
    if (!target || target.kind === 'player' && args.allowPlayer !== true) throw new Error("No authorized target.");
    const shieldedTarget = shieldFaces(target,c.state.position);
    const avoidSweep=[...c.entities.values()].some(e=>e.kind==='player'&&e.gameMode!==3&&e!==target&&String(e.id)!==String(c.state.entityId)&&distance(e.position,target.position)<2);
    if(c.inventory.items().some(i=>i.name==='shield'&&remainingDurability(i,c.registry)>0))await prepareShield(c,signal);
    const weapon = chooseWeapon(c.inventory.items().filter(i => remainingDurability(i, c.registry) > 0), { shieldedTarget, avoidSweep });
    if (weapon && c.inventory.held()?.slot !== weapon.slot) await select(c, weapon, signal);
    else if (!weapon) await emptyHand(c, signal);
    c.combatPursuit ??= new CombatPursuit();
    const until = Date.now() + duration;
    while (Date.now() < until) {
      alive(c, signal); if (c.entities.get(Number(target.id)) !== target) return { ok: true, targetGone: true, deathConfirmed: false };
      if (distance(c.state.position, target.position) > maxDistance) throw new Error("Target moved beyond pursuit range.");
      const now=performance.now(),shield=c.inventory.slots[45]?.name==='shield'&&remainingDurability(c.inventory.slots[45],c.registry)>0;
      if(c.combatJump){if(!c.state.onGround)c.combatJump.airborne=true;if(c.combatJump.target!==target.id||now>c.combatJump.until||c.combatJump.airborne&&c.state.onGround)c.combatJump=null;}
      const jumpKey=String(target.id)+'/'+(c.nextAttackAt||0),nearby=[...c.entities.values()].filter(e=>e!==target&&e.kind==='player'&&distance(e.position,c.state.position)<3).length;
      const safeJump=args.critical!==false&&weapon&&c.state.health>12&&c.state.food>6&&!nearby&&!c.guarding&&c.state.onGround&&c.criticalAttempt!==jumpKey&&['x','z'].every(axis=>[-1,1].every(sign=>safeCorridor(c.state.position,{x:axis==='x'?sign:0,z:axis==='z'?sign:0},1,p=>c.world.blockAt(p),{headroom:4})));
      let tactic = combatDecision({ self: { ...c.state, shield,shieldDisabledUntil:c.shieldDisabledUntil }, target: { ...target,blocking:shieldFaces(target,c.state.position), charging: target.name === 'blaze' && Boolean(target.metadata.flags & 1) },
        projectiles: [...c.entities.values()].filter(e => ['arrow', 'small_fireball', 'fireball', 'trident'].includes(e.name)), nextAttackAt: c.nextAttackAt || 0, now, retreatHealth: args.retreatHealth ?? 8,criticalPending:Boolean(c.combatJump),canCriticalJump:safeJump });
      if(target.name==='enderman'&&c.world.blockAt(floor(c.state.position))?.name==='water'&&['approach','strafe','jump'].includes(tactic.mode))tactic={...tactic,mode:'hold'};
      if(tactic.mode!=='retreat'){
        const pursuit=c.combatPursuit.observe({target,position:c.state.position,dimension:c.state.dimension,now,maxDistance});
        if(!pursuit.allowed){c.stopMovement();throw new Error(pursuit.reason);}
      }
      if (!['approach', 'retreat', 'strafe'].includes(tactic.mode)) c.stopMovement();
      c.lookAt({ ...target.position, y: target.position.y + 1 }, { signal, turnSpeed: 720 });
      if (tactic.mode === 'block') {c.combatJump=null;return runAction(c, { skill: 'guard', args: { entityId:target.id,durationMs: Math.max(250, Math.min(600, until - Date.now())) } }, signal);}
      if (tactic.mode === 'jump') {c.combatJump||={target:target.id,until:now+1500,airborne:false};c.criticalAttempt=jumpKey;c.control={x:0,z:0,jump:true,sprint:false};}
      if (tactic.mode === 'strike') {
        if(avoidSweep&&weaponProfile(c.inventory.held()?.name).kind==='sword'&&!tactic.critical)throw new Error("A foreign player is in the vicinity: A mass strike by a sword is unsafe.");
        try{await runAction(c,{skill:'attack',args:{entityId:target.id,allowPlayer:args.allowPlayer===true}},signal);c.combatPursuit.attackSent(performance.now());}
        catch(error){signal.throwIfAborted();if(error.code!=='KUDO_TARGET_MOVED')throw error;c.combatRoute=null;}
        c.combatJump=null;
      }
      if (['approach', 'retreat', 'strafe'].includes(tactic.mode)) {
        c.control = tactic.mode==='approach'?await combatApproach(c,target,signal):combatControl(c.state, target.position, tactic.mode, p => c.world.blockAt(p), { guarding: c.guarding, strafeSide: Math.floor(Date.now() / 1800) % 2 ? -1 : 1 });
      }
      await delay(25, undefined, { signal });
    }
    return { ok: true, frameFinished: true };
  }
  if (skill === 'guard') {
    const duration = args.durationMs ?? 400; if (!Number.isInteger(duration) || duration < 50 || duration > 2000) throw new Error('guard.durationMs: 50–2000.');
    if(performance.now()<(c.shieldDisabledUntil||0))throw new Error("The server temporarily disabled the shield.");
    await prepareShield(c,signal);
    c.write('use_item', { hand: 1, sequence: ++c.sequence, rotation: { x: c.state.yaw, y: c.state.pitch } }); c.guarding = true;
    try { const until=Date.now()+duration;while(Date.now()<until){alive(c,signal);if(performance.now()<(c.shieldDisabledUntil||0))return {ok:true,shieldDisabled:true};const e=c.entities.get(Number(args.entityId));if(e)c.lookAt({...e.position,y:e.position.y+1},{signal,turnSpeed:720});await delay(25,undefined,{signal});}return { ok: true, guardingRequested: true }; }
    finally { c.guarding = false; if (c.client.state === 'play') c.write('block_dig', { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence }); }
  }
  if (skill === 'wait') { const ms = args.durationMs ?? 100; if (!Number.isInteger(ms) || ms < 1 || ms > 2000) throw new Error('wait.durationMs: 1–2000.'); await delay(ms, undefined, { signal }); return { ok: true }; }
}

async function prepareShield(c,signal){
  if(c.inventory.slots[45]?.name==='shield')return;
  const previous=c.inventory.selected;
  await select(c,'shield',signal);const revision=c.inventory.revision;
  c.write('block_dig',{status:6,location:{x:0,y:0,z:0},face:0,sequence:++c.sequence});
  await c.waitFor(()=>c.inventory.revision>revision&&c.inventory.slots[45]?.name==='shield',{signal,event:'inventory',timeoutMs:3000});
  // Restore the weapon slot once, rather than repeating a shield/weapon swap each combat frame.
  if(c.inventory.selected!==previous&&c.inventory.slots[36+previous])await select(c,c.inventory.slots[36+previous],signal);
}

async function shoot(c, args, signal) {
  const weapon = args.weapon ?? 'bow', chargeTicks = args.chargeTicks ?? 20;
  if (!['bow', 'crossbow'].includes(weapon) || !Number.isInteger(chargeTicks) || chargeTicks < 3 || chargeTicks > 20) throw new Error('shoot: bow/crossbow, chargeTicks 3–20.');
  const target = () => {
    const e = c.entities.get(Number(args.entityId));
    if (!e || e.kind === 'player' && args.allowPlayer !== true) throw new Error("No authorized target shot; PvP requires allowPlayer.");
    if(e.name==='end_crystal' && distance(c.state.position,e.position)<12)throw new Error("Crystal firing requires a distance of at least 12 blocks.");
    if(e.name==='ender_dragon' && [5,6,7,9].includes(e.metadata?.phase))throw new Error("Dragon sits or dies: No need for a shot now.");
    return e;
  };
  const initialTarget=target(); await select(c, weapon, signal); c.stopMovement();
  const loaded = () => c.inventory.held()?.raw.components?.find(p => p.type === 'charged_projectiles')?.data?.projectiles || [];
  const ammunition = () => c.inventory.count('arrow') + c.inventory.count('spectral_arrow') + c.inventory.count('tipped_arrow');
  const durabilityUsed=()=>c.inventory.held()?.raw.components?.find(p=>p.type==='damage')?.data??0;
  if (!ammunition() && !(weapon === 'crossbow' && loaded().length)) throw new Error("No arrows.");
  const aim = () => {
    const e = target(), s = c.state;
    const solution = solveAim({ origin: { ...s.position, y: s.position.y + 1.52 }, target: { ...e.position, y: e.position.y + (c.registry.entitiesByName[e.name]?.height ?? 1.8) / 2 }, targetVelocity: e.velocity,
      inheritedVelocity: { x: s.velocity.x, y: s.onGround ? 0 : s.velocity.y, z: s.velocity.z }, weapon, chargeTicks, getBlock: p => c.world.blockAt(p) });
    if (solution.status !== 'aimed') throw new Error(`No trajectory: ${solution.reason}.`);
    return solution;
  };
  const turn=async()=>{
    const direction=(solution,s)=>{const yaw=solution.yaw*Math.PI/180,pitch=solution.pitch*Math.PI/180;return {x:s.x-Math.sin(yaw)*Math.cos(pitch)*20,y:s.y+1.62-Math.sin(pitch)*20,z:s.z+Math.cos(yaw)*Math.cos(pitch)*20};};
    for(let i=0;i<4;i++){
      const solution=aim();
      c.lookAt(direction(solution,c.state.position),{signal,turnSpeed:720});
      await c.waitForLook({signal});
      const fresh=aim();
      if(Math.hypot(wrapDegrees(fresh.yaw-c.state.yaw),fresh.pitch-c.state.pitch)<1)return fresh;
      // A flying dragon can move several blocks during the turn. Finish with
      // one current, server-sent angle instead of endlessly chasing old aim.
      if(i>=1&&target().name==='ender_dragon'){
        c.lookAt(direction(fresh,c.state.position),{signal,immediate:true});
        const latest=aim();
        if(Math.hypot(wrapDegrees(latest.yaw-c.state.yaw),latest.pitch-c.state.pitch)<4)return latest;
      }
    }
    throw new Error("Target shifted when set; I need a new shot.");
  };
  await turn(); const originalSlot = c.inventory.selected;
  let using = false, released = false;
  const use = () => c.write('use_item', { hand: 0, sequence: ++c.sequence, rotation: { x: c.state.yaw, y: c.state.pitch } });
  try {
    if (weapon === 'bow' || !loaded().length) {
      use(); using = true;
      await delay((weapon === 'crossbow' ? 26 : chargeTicks + 1) * 50, undefined, { signal });
      if (weapon === 'crossbow') await c.waitFor(() => loaded().length > 0, { signal, event: 'inventory', timeoutMs: 2000 });
    }
    alive(c, signal); const solution = await turn(), ammoBefore = ammunition(),damageBefore=durabilityUsed(),priorEntities = new Set(c.entities.keys());
    if (weapon === 'crossbow' && loaded().some(raw => !['arrow', 'spectral_arrow', 'tipped_arrow'].includes(c.registry.items[raw.itemId]?.name))) throw new Error("For this ballistics, the crossbow must contain arrows.");
    if (weapon === 'bow') c.write('block_dig', { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence });
    else use();
    released = true; using = false;
    const releasedAt=Date.now(),until = releasedAt + 2000;
    while (Date.now() < until) {
      alive(c, signal);
      const projectile = [...c.entities].find(([id, e]) => !priorEntities.has(id) && ['arrow', 'spectral_arrow'].includes(e.name) && e.ownerId === c.state.entityId);
      if (projectile || weapon === 'bow' && (ammunition() < ammoBefore||durabilityUsed()>damageBefore) || weapon === 'crossbow' && !loaded().length) return { ok: true, shotServerConfirmed: true, hitConfirmed: false, projectileId: projectile?.[0] ?? null, flightTicks: solution.ticks, yaw: solution.yaw, pitch: solution.pitch };
      if(initialTarget.name==='end_crystal'&&c.endgame.crystals?.some(e=>String(e.entityId)===String(args.entityId)&&e.at>=releasedAt))
        return {ok:true,shotServerConfirmed:false,hitConfirmed:false,crystalDestroyedServerConfirmed:true,flightTicks:solution.ticks,yaw:solution.yaw,pitch:solution.pitch};
      await delay(25, undefined, { signal });
    }
    throw new Error("Shots fired, but the server did not confirm the projectile or the ammunition consumption. Do not repeat automatically.");
  } finally {
    // Switching slots cancels a drawn bow without releasing its arrow at the old target.
    if (using && !released && c.client.state === 'play') {
      c.write('held_item_slot', { slotId: (originalSlot + 1) % 9 }); c.write('held_item_slot', { slotId: originalSlot });
    }
  }
}

async function lootChest(c, args, signal) {
  if (!point(args)) throw new Error("lootChest: requires x/y/z.");
  const maxStacks = args.maxStacks ?? 54;
  if (!Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > 54 || args.items !== undefined && (!Array.isArray(args.items) || !args.items.length || args.items.length > 128)) throw new Error("lootChest: maxStacks 1–54, items — list ID.");
  const allowed = args.items?.map(name), position = floor(args), transferred = [];
  if (c.containers.current) throw new Error("Another window is already open.");
  await approach(c, position, signal);
  if (!isStorageBlock(c.world.blockAt(position)?.name)) throw new Error("There's no observed vault.");
  const identity = storageIdentity(c.world,position);
  if (c.inventory.cursor) throw new Error("First, release the item on the directional.");
  c.lookAt(center(position)); await c.waitForLook?.({ signal }); let opened = false;
  c.containerRequest = true;
  try {
    c.write('block_place', { hand: 0, location: position, direction: 1, cursorX: .5, cursorY: .5, cursorZ: .5, insideBlock: false, sequence: ++c.sequence });
    await c.waitFor(() => Boolean(c.containers.current?.ready), { signal, event: 'container', timeoutMs: 4000 }); opened = true;
    const w = c.containers.current; let reason = 'empty-or-filtered';
    for (let i = 0; i < maxStacks; i++) {
      alive(c, signal); if (c.containers.current !== w) throw new Error("Server closed or replaced the window.");
      const source = c.containers.contents().find(s => (!allowed || allowed.includes(s.name)) && c.containers.capacity(s) > 0);
      if (!source) { if (c.containers.contents().some(s => !allowed || allowed.includes(s.name))) reason = 'inventory-full'; break; }
      const before = c.inventory.count(source.name), revision = c.containers.revision;
      c.write('window_click', { windowId: w.id, stateId: w.stateId, slot: source.slot, mouseButton: 0, mode: 1, changedSlots: [], cursorItem: { itemCount: 0 } });
      await c.waitFor(() => c.containers.current === w && c.containers.revision > revision && c.inventory.count(source.name) > before && (w.slots[source.slot]?.count ?? 0) < source.count, { signal, event: 'container', timeoutMs: 3000 });
      transferred.push({ item: source.item, count: c.inventory.count(source.name) - before }); reason = 'stack-budget';
    }
    c.containers.remember(c.state.dimension, position, identity);
    return { ok: true, serverConfirmed: true, position, transferred, reason };
  } finally {
    const w = c.containers.current;
    try {
      if (w) { if (opened && w.ready) c.containers.remember(c.state.dimension, position, identity); if (c.client.state === 'play') c.write('close_window', { windowId: w.id }); }
    } finally { if (w) c.containers.close(w.id); c.containerRequest = false; }
  }
}
