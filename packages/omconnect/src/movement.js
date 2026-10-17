import { setTimeout as delay } from 'node:timers/promises';
import { planRouteAsync, readRouteWorld, isAir, isFullBlock, isHazard } from './navigation.js';
import { gazeAngles } from './players.js';
import {assessFall} from './fall.js';
import {chooseMiningTool} from './equipment.js';
import {editDecision} from './protection.js';
import {executeCreativeFly} from './creative-flight.js';
import {OMActionError} from './failures.js';
import {routeFacingTarget} from './route-facing.js';
import {walkTarget,continuesWalk} from './route-cursor.js';
import {createNavigationCoordination} from './navigation-coordination.js';
import {consumeNavigationRoute} from './route-lease.js';
import {volumeClearance} from './traversal.js';
import {predictMotion,createMotionProgress} from './motion-v2.js';

/** Deliberate route excavation only consumes common terrain with an appropriate tool. */
export const routeCanDig = (c,{requireHarvest=true}={}) => {
  let revision, protectionRevision; const decisions = new Map();
  return (block, position) => {
    if (!/^(?:minecraft:)?(?:stone|deepslate|cobblestone|cobbled_deepslate|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mycelium|netherrack|tuff|granite|diorite|andesite)$/.test(block.name||block.id) || block.diggable === false || block.hardness < 0 || !chooseMiningTool(c.registry, block, c.inventory.items(), {held:c.inventory.held(),onGround:true,requireHarvest})) return false;
    if (revision !== c.world.revision || protectionRevision !== c.protection?.revision) { decisions.clear(); revision = c.world.revision; protectionRevision = c.protection?.revision; }
    const id = `${position.x},${position.y},${position.z}`;
    if (!decisions.has(id)) { if (decisions.size >= 4096) decisions.clear(); decisions.set(id, editDecision(c, 'dig', position).allowed); }
    return decisions.get(id);
  };
};

const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const validPoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
export const wrapDegrees = angle => ((angle + 180) % 360 + 360) % 360 - 180;

/** A grounded body can overlap a neighboring cube while its center is over air. */
export function groundAnchor(position,getBlock){
  const feet=floor(position),candidates=[];
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const p={x:feet.x+dx,y:feet.y,z:feet.z+dz};
    if(position.x+.3<=p.x||position.x-.3>=p.x+1||position.z+.3<=p.z||position.z-.3>=p.z+1)continue;
    if(isFullBlock(getBlock({...p,y:p.y-1}))&&isAir(getBlock(p))&&isAir(getBlock({...p,y:p.y+1})))candidates.push(p);
  }
  return candidates.sort((a,b)=>Math.hypot(a.x+.5-position.x,a.z+.5-position.z)-Math.hypot(b.x+.5-position.x,b.z+.5-position.z))[0]??null;
}

/** Use the existing physics loop to settle and center on an intersecting support. */
export async function settleGround(c,signal){
  if(c.state.gameMode==='creative'&&c.state.allowFlying||c.state.environment?.medium==='water')return;
  const alive=()=>{signal.throwIfAborted();if(c.state.health<=0||c.state.status!=='ready')throw new Error('Agent is unavailable.');};
  alive();c.stopMovement();
  if(!c.state.onGround||Math.hypot(c.state.velocity.x,c.state.velocity.z)>.04)await c.waitFor(()=>{alive();return c.state.onGround&&Math.hypot(c.state.velocity.x,c.state.velocity.z)<.04;},{signal,event:'physics',timeoutMs:2000});
  const feet=floor(c.state.position);
  if(isFullBlock(c.world.blockAt({...feet,y:feet.y-1})))return;
  const anchor=groundAnchor(c.state.position,p=>c.world.blockAt(p));if(!anchor)return;
  try{
    await c.waitFor(()=>{
      alive();
      if(!c.state.onGround||!isFullBlock(c.world.blockAt({...anchor,y:anchor.y-1})))throw new OMActionError('SUPPORT_CHANGED','The grounding support changed.');
      const dx=anchor.x+.5-c.state.position.x,dz=anchor.z+.5-c.state.position.z,d=Math.hypot(dx,dz);
      c.control={x:dx*.7,z:dz*.7,jump:false,sprint:false};return d<.06;
    },{signal,event:'physics',timeoutMs:2500});
    c.stopMovement();await c.waitFor(()=>{alive();return c.state.onGround&&Math.hypot(c.state.velocity.x,c.state.velocity.z)<.04;},{signal,event:'physics',timeoutMs:1500});
  }finally{c.stopMovement();}
}

/** Degrees and seconds; yaw follows the shortest arc, with bounded, eased rotation. */
export function rotateToward(state, angles, { turnSpeed = 540, dt = .05 } = {}) {
  if (![state.yaw, state.pitch, angles.yaw, angles.pitch, turnSpeed, dt].every(Number.isFinite) || turnSpeed < 30 || turnSpeed > 1440 || dt < 0) throw new Error("Uncorrect Turnpoints.");
  const elapsed = Math.min(.1, dt), limit = turnSpeed * elapsed, easing = 1 - Math.exp(-14 * elapsed);
  const advance = error => Math.abs(error) < .1 ? error : Math.sign(error) * Math.min(Math.abs(error) * easing, limit);
  return { yaw: wrapDegrees(state.yaw + advance(wrapDegrees(angles.yaw - state.yaw))), pitch: Math.max(-90, Math.min(90, state.pitch + advance(angles.pitch - state.pitch))) };
}

export class SmoothLook {
  target = null;
  set(state, target, { signal, turnSpeed = 540, immediate = false } = {}) {
    signal?.throwIfAborted();
    if (!validPoint(state.position) || !validPoint(target) || !Number.isFinite(turnSpeed) || turnSpeed < 30 || turnSpeed > 1440) throw new Error("lookAt: A known position, Objective and turnSpeed 30–1440.");
    this.target = { position: { ...target }, turnSpeed, signal };
    if (immediate) { Object.assign(state, this.angles(state)); this.clear(); }
  }
  angles(state) { return gazeAngles({ ...state.position, y: state.position.y + 1.62 }, this.target.position); }
  tick(state, dt = .05, safeAngles = null) {
    if (!this.target) return;
    if (this.target.signal?.aborted || !state.position) { this.clear(); return; }
    const angles = this.angles(state);
    const next=rotateToward(state, angles, { turnSpeed: this.target.turnSpeed, dt });
    Object.assign(state, safeAngles ? safeAngles(state,next) : next);
    const final=safeAngles?safeAngles(state,angles):angles;
    if (Math.hypot(wrapDegrees(angles.yaw - state.yaw), angles.pitch - state.pitch) < .1 && Math.hypot(wrapDegrees(final.yaw-angles.yaw),final.pitch-angles.pitch)<.001) { Object.assign(state, angles); this.clear(); }
  }
  clear() { this.target = null; }
}

/** The fallback rotates only; it never runs extra physics ticks or changes position. */
export async function waitForLook(client, { signal = client.pending?.signal, timeoutMs = 3000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw new Error('waitForLook: timeoutMs 50–10000.');
  const target = client.look.target, until = Date.now() + timeoutMs;
  while (target && client.look.target === target) {
    signal?.throwIfAborted(); target.signal?.throwIfAborted();
    if (Date.now() > until) throw new Error("Turn budget to target.");
    await delay(25, undefined, { signal });
    if (!client.timer) { client.tickLook(.025); client.sendPosition(); }
  }
  signal?.throwIfAborted();
}

// Select ordinary, static, full cubes. Gravity blocks and functional/valuable blocks
// are never consumed accidentally even when their nominal collision shape is full.
const protectedBlocks = /(?:^|_)(?:ore|chest|shulker_box|furnace|smoker|beacon|spawner|anvil|bed|glass|leaves|ice|coral|sponge|tnt|redstone|piston|observer|dispenser|dropper|hopper|cauldron|command_block|structure_block|jigsaw|sculk)(?:$|_)/;
const protectedNames = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel', 'dragon_egg', 'sniffer_egg', 'turtle_egg', 'crafting_table', 'barrel', 'enchanting_table', 'brewing_stand', 'smithing_table', 'fletching_table', 'cartography_table', 'loom', 'note_block', 'jukebox', 'respawn_anchor', 'lodestone', 'conduit', 'slime_block', 'honey_block', 'soul_sand', 'soul_soil', 'ancient_debris', 'obsidian', 'crying_obsidian', 'amethyst_block', 'budding_amethyst', 'hay_block', 'dried_kelp_block', 'melon', 'pumpkin', 'carved_pumpkin', 'jack_o_lantern', 'bookshelf', 'chiseled_bookshelf']);
const baseBridgeValue = name => /^(?:dirt|cobblestone|cobbled_deepslate|netherrack)$/.test(name) ? 1 : /(?:stone|diorite|andesite|granite|tuff|deepslate)$/.test(name) ? 2 : /_planks$/.test(name) ? 4 : /(?:_log|_wood|_stem|_hyphae)$/.test(name) ? 8 : 5;
export function bridgeMaterials(registry, items, { blockAtState, itemValue = baseBridgeValue, reserve = 0,dimension } = {}) {
  if (typeof itemValue !== 'function' || !Number.isInteger(reserve) || reserve < 0) throw new Error("Bridge materials: itemValue and reserve.");
  const result = [];
  for (const item of items) {
    const name = (item.name || item.item || '').replace(/^minecraft:/, ''), data = registry.blocksByName[name];
    if(dimension==='minecraft:the_nether'&&!/^(crimson|warped)_/.test(name)&&/(?:_planks|_log|_wood|_stem|_hyphae|_wool)$|^bamboo_(?:block|mosaic)$/.test(name))continue;
    if (!data || item.count <= reserve || data.boundingBox !== 'block' || protectedNames.has(name) || protectedBlocks.test(name) || /_concrete_powder$|^(?:raw_)?(?:iron|gold|diamond|emerald|netherite|lapis|coal|copper)_block$/.test(name)) continue;
    const block = blockAtState?.(data.defaultState) || data;
    if (!isFullBlock(block) || isHazard(block)) continue;
    const value = itemValue(name, item);
    if (!Number.isFinite(value) || value < 0) continue;
    result.push({ name, block: 'minecraft:' + name, count: item.count - reserve, value, slot: item.slot });
  }
  return result.sort((a, b) => a.value - b.value || b.count - a.count || a.name.localeCompare(b.name));
}

/** Checks the complete player footprint along a flat segment. Unknown is impassable. */
export function safeCorridor(position, direction, length, getBlock, { headroom = 2 } = {}) {
  if (!validPoint(position) || !Number.isFinite(length) || length < 0 || length > 16 || typeof getBlock !== 'function') return false;
  const size = Math.hypot(direction.x, direction.z); if (!size) return false;
  const y = Math.round(position.y); if (Math.abs(position.y - y) > .08) return false;
  const seen = new Set();
  for (let sample = 0; sample <= Math.ceil(length / .2); sample++) {
    const t = Math.min(length, sample * .2);
    const x = position.x + direction.x / size * Math.min(t, length), z = position.z + direction.z / size * Math.min(t, length);
    for (const ox of [-.3, .3]) for (const oz of [-.3, .3]) {
      const p = { x: Math.floor(x + ox), y, z: Math.floor(z + oz) }, id = p.x + ',' + p.z;
      if (seen.has(id)) continue; seen.add(id);
      if (!isFullBlock(getBlock({ ...p, y: y - 1 }))) return false;
      for (let h = 0; h < headroom; h++) if (!isAir(getBlock({ ...p, y: y + h }))) return false;
    }
  }
  return true;
}

export function travelControl(state, target, getBlock, { sprint = true, sprintJump = true, guarding = false, longDistance = 8, brake = true } = {}) {
  const dx = target.x - state.position.x, dz = target.z - state.position.z, d = Math.hypot(dx, dz);
  if (d < .04) return { x: 0, z: 0, jump: false, sprint: false };
  const direction = { x: dx / d, z: dz / d }, desired = gazeAngles(state.position, { ...target, y: state.position.y });
  const facing = Math.abs(wrapDegrees(desired.yaw - (state.yaw || 0))) < 35;
  const airborneRun = state.sprinting && !state.onGround && state.position.y >= target.y && state.position.y - target.y <= 1.6;
  const supportPosition = airborneRun ? { ...state.position, y: target.y } : state.position;
  const safe = d >= 1.5 && safeCorridor(supportPosition, direction, Math.min(d, 2), getBlock, { headroom: airborneRun ? 4 : 2 });
  const running = Boolean(sprint && state.food > 6 && !guarding && facing && safe && !state.horizontalCollision);
  // Braking preserves server physics: reduce input, never edit position or velocity.
  const speed = brake && d < .8 ? Math.max(.08, Math.min(.7, d * 1.5)) : 1;
  return { x: direction.x * speed, z: direction.z * speed, sprint: running,
    jump: Boolean(running && sprintJump && state.onGround && d >= longDistance && safeCorridor(state.position, direction, 6, getBlock, { headroom: 4 })) };
}

export function combatControl(state, target, mode, getBlock, { guarding = false, strafeSide = 1, spacing } = {}) {
  const dx = target.x - state.position.x, dz = target.z - state.position.z, d = Math.hypot(dx, dz) || 1;
  const forward = { x: dx / d, z: dz / d }, side = { x: forward.z * strafeSide, z: -forward.x * strafeSide };
  const radial = spacing === undefined ? 0 : Math.max(-.65, Math.min(.5, (d-spacing)*.8));
  const orbit = sign => { const x=side.x*sign+forward.x*radial,z=side.z*sign+forward.z*radial,n=Math.hypot(x,z);return {x:x/n,z:z/n}; };
  const options = mode === 'retreat' ? [{ x: -forward.x, z: -forward.z }, side, { x: -side.x, z: -side.z }] : mode === 'strafe' ? [orbit(1), orbit(-1)] : mode === 'approach' ? [forward, side, { x: -side.x, z: -side.z }] : [];
  for (const direction of options) {
    if (!safeCorridor(state.position, direction, 1.3, getBlock)) continue;
    const control = travelControl(state, { x: state.position.x + direction.x * (mode === 'approach' ? d : 2), y: state.position.y, z: state.position.z + direction.z * (mode === 'approach' ? d : 2) }, getBlock, { guarding, sprintJump: false });
    // Sprinting while facing the enemy only makes sense when closing the gap.
    return { ...control, sprint: mode === 'approach' && d > 4 && control.sprint, jump: false };
  }
  return { x: 0, z: 0, jump: false, sprint: false };
}

export function personalSpaceControl(state,control,entities,getBlock,ownId,{canMove,lookAhead=1.2}={}){
  if(!Number.isFinite(lookAhead)||lookAhead<0||lookAhead>1.2)throw new Error('lookAhead: 0–1.2.');
  if(!state.onGround)return control;
  const peers=entities.filter(e=>e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(ownId)&&e.position&&Math.abs(e.position.y-state.position.y)<1.8&&Math.hypot(e.position.x-state.position.x,e.position.z-state.position.z)<4.5);
  if(!peers.length)return control;
  let x=control.x,z=control.z;
  for(const e of peers){let dx=state.position.x-e.position.x,dz=state.position.z-e.position.z,d=Math.hypot(dx,dz);if(d<1){if(d<.01){dx=String(ownId)<String(e.id)?1:-1;dz=0;d=1;}const push=(1.1-Math.min(d,1))/.4;x+=dx/d*push;z+=dz/d*push;}}
  const size=Math.hypot(x,z);if(!size)return {...control,x:0,z:0,sprint:false,jump:false};
  for(const angle of [0,.7,-.7,1.4,-1.4,Math.PI]){
    const direction={x:(x*Math.cos(angle)-z*Math.sin(angle))/size,z:(x*Math.sin(angle)+z*Math.cos(angle))/size};
    // Anticipate crossing trajectories over four physics ticks; no position prediction is applied to the world.
    const threatened=peers.some(e=>[0,2,4].some(ticks=>{const velocity=k=>Number.isFinite(e.velocity?.[k])?Math.max(-.8,Math.min(.8,e.velocity[k])):0;const dx=e.position.x+velocity('x')*ticks-state.position.x,dz=e.position.z+velocity('z')*ticks-state.position.z,t=Math.max(0,Math.min(lookAhead,dx*direction.x+dz*direction.z));return Math.hypot(dx-direction.x*t,dz-direction.z*t)<.75&&dx*direction.x+dz*direction.z>0;}));
    if(!threatened&&(canMove?canMove(direction):safeCorridor(state.position,direction,lookAhead,getBlock)))return {...control,x:direction.x*Math.min(1,size),z:direction.z*Math.min(1,size),sprint:false,jump:Boolean(canMove&&control.jump)};
  }
  return {x:0,z:0,sprint:false,jump:false};
}

export async function executeNavigate(c, args, signal, { place, dig, replans=0, segments=0 } = {}) {
  if (!validPoint(args)) throw new Error("Navigation: requires x/y/z.");
  if(c.state.gameMode==='creative'&&c.state.allowFlying&&args.creativeFlight!==false&&args.excavate!==true&&Math.hypot(args.x-c.state.position.x,args.z-c.state.position.z)>3){
    return executeCreativeFly(c,{x:Math.floor(args.x),y:Math.floor(args.y),z:Math.floor(args.z),land:true},signal);
  }
  const range = args.range ?? 1;
  if (!Number.isInteger(range) || range < 0 || range > 8) throw new Error('range: 0–8.');
  const alive = () => { signal.throwIfAborted(); if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error("Agent is unavailable."); };
  alive();
  c.stopMovement();
  await settleGround(c,signal);
  const start = floor(c.state.position), plannedCorrections = c.metrics.corrections;
  const materials = () => bridgeMaterials(c.registry, c.inventory.items(), { blockAtState: id => c.world.Block?.fromStateId(id, 0), itemValue: c.options?.bridgeItemValue || baseBridgeValue, reserve: c.options?.bridgeReserve ?? 0,dimension:c.state.dimension });
  const blocks = args.bridge === false ? [] : materials(), budget = Math.min(256, blocks.reduce((sum, b) => sum + b.count, 0));
  const occupied=p=>[...c.entities.values()].some(e=>e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(c.state.entityId)&&Math.abs(e.position.y-p.y)<1.8&&Math.hypot(e.position.x-(p.x+.5),e.position.z-(p.z+.5))<.8);
  const fallPolicy={health:c.state.health,minHealthAfter:c.options?.fallHealthReserve??6,maxDamage:c.options?.maxFallDamage??6};
  const dimensionDrop=c.state.dimension==='minecraft:overworld'?16:3;
  const view = readRouteWorld(c.world);
  const search=(options,scheduling)=>c.vectorize?.planGroundSegmentAsync&&args.navigationV2!==false?c.vectorize.planGroundSegmentAsync(options,scheduling):c.vectorize?.planGroundAsync?c.vectorize.planGroundAsync(options,scheduling):planRouteAsync(options,scheduling);
  const prepared=consumeNavigationRoute(c,start,args);
  if(prepared)c.metrics.routePlansReused=(c.metrics.routePlansReused||0)+1;
  const route = prepared ?? await search({ start, goal: floor(args), range, occupied, staticGeometry:args.excavate!==true&&budget===0,canDig:args.excavate===true?routeCanDig(c):()=>false, edgeCost:c.navigationPolicy?.cost, getBlock: view.getBlock, maxDistance: 128, maxNodes: 12000, maxDrop:args.maxDrop??c.options?.maxDrop??dimensionDrop,fallPolicy,
    bridgeBudget: typeof place === 'function' ? budget : 0, bridgeBlock: blocks[0]?.block || 'minecraft:cobblestone', canPlace:p=>editDecision(c,'place',p).allowed, signal }, { getRevision: view.getRevision });
  alive();
  if (c.metrics.corrections !== plannedCorrections || ['x', 'y', 'z'].some(axis => Math.floor(c.state.position[axis]) !== start[axis])) throw new OMActionError('STALE_WORLD', "Start position changed during route search; replanning is required.");
  if (route.status !== 'planned') throw new OMActionError(route.failure?.code || 'NO_PATH', route.reason, route.failure?.evidence);
  c.navigationDebug={dimension:c.state.dimension,status:'running',startedAt:Date.now(),goal:floor(args),strategy:route.strategy||'local-astar',partial:route.partial===true,segment:segments,index:0,steps:route.steps.slice(0,512).map(step=>({kind:step.kind,position:{...step.position}})),truncated:route.steps.length>512};
  const corrections = c.metrics.corrections, coordination=createNavigationCoordination(c,signal);let segment=null, bridgeWalk=false;
  try {
    for (let i = 0; i < route.steps.length; i++) {
      c.navigationDebug.index=i;
      alive(); const step = route.steps[i];
      if(step.kind!=='walk')coordination.release();
      if (step.kind === 'bridge') {
        bridgeWalk=true; c.stopMovement({ sneak:true });
        // Wait for ordinary friction before opening a placement operation at an edge.
        await c.waitFor(() => Math.hypot(c.state.velocity.x, c.state.velocity.z) < .025 && c.state.onGround, { signal, timeoutMs: 2000 });
        const block = materials()[0]; if (!block || !place) throw new Error("No safe blocks to continue the bridge.");
        const before = c.inventory.items().filter(i=>i.name===block.name).reduce((n,i)=>n+i.count,0);
        await place({ ...step.position, block: block.block }, signal);
        if (!isFullBlock(c.world.blockAt(step.position))) throw new Error("The server did not confirm the bridge support.");
        await c.waitFor(()=>c.inventory.items().filter(i=>i.name===block.name).reduce((n,i)=>n+i.count,0)<before,{event:'inventory',signal,timeoutMs:2000});
        alive();
        if (!isFullBlock(c.world.blockAt(step.position))) throw new Error("The confirmed bridge support is gone.");
        continue;
      }
      if (step.kind === 'dig') { if (!dig) throw new Error("No route mining operator."); c.stopMovement(); await dig({ ...step.position, block: step.expected }, signal); continue; }
      const corridor=(position,direction,length)=>safeCorridor(position,direction,length,p=>c.world.blockAt(p));
      const last=walkTarget(c.state,route.steps,i,corridor,{shortcuts:!c.navigationPolicy&&!c.navigationCoordinator&&!bridgeWalk});
      const continuing=!bridgeWalk&&continuesWalk(c.state,route.steps,last,corridor);
      const shortcut=step.kind==='walk'&&route.steps.slice(i,last+1).some((s,n,a)=>n>1&&(s.position.x-a[n-1].position.x!==a[1].position.x-a[0].position.x||s.position.z-a[n-1].position.z!==a[1].position.z-a[0].position.z));
      // Keep crouching across narrow spans; verified wide ground permits running.
      const endpoint = route.steps[last].position, target = { x: endpoint.x + .5, y: endpoint.y, z: endpoint.z + .5 };
      let until = Date.now() + 5000 + (last - i) * (bridgeWalk ? 1200 : 700);
      const segmentStartedAt=Date.now();
      segment={from:floor(c.state.position),to:{...endpoint},kind:step.kind,dimension:c.state.dimension,health:c.state.health,food:c.state.food};
      Object.assign(segment,c.navigationPolicy?.describeTransition?.(segment.from,segment.to,segment.kind),{startedAt:segmentStartedAt});
      const learnedContexts=[];let contextFrom=segment.from;
      for(let n=i;n<=last;n++){const s=route.steps[n];learnedContexts.push(c.navigationPolicy?.describeTransition?.(contextFrom,s.position,s.kind));contextFrom=s.position;}
      let progress=createMotionProgress({timeoutMs:2500});
      const coordinated=Boolean(c.navigationCoordinator)&&step.kind==='walk'&&segment.from.y===endpoint.y;
      const groundPath=[segment.from,...route.steps.slice(i,last+1).map(s=>s.position)];
      let predicted=false;
      while (Math.hypot(c.state.position.x - target.x, c.state.position.z - target.z) > (continuing?.4:.18) || Math.abs(c.state.position.y - target.y) > .12 || !c.state.onGround) {
        alive(); if (Date.now() > until) throw new OMActionError('STEP_STALLED', "Movement step time budget expired.");
        if(progress.update(c.state.position,target).stuck)throw new OMActionError('STUCK','No progress toward the local route endpoint.');
        if (c.metrics.corrections !== corrections) throw new OMActionError('SERVER_CORRECTION', 'The server corrected the position; replan from the corrected location.');
        if(c.state.onGround&&route.steps.slice(i,last+1).some(s=>occupied(s.position)&&Math.hypot(s.position.x+.5-c.state.position.x,s.position.z+.5-c.state.position.z)>.9)){
          c.stopMovement();if(replans>=4)throw new OMActionError('OCCUPIED', "The route is occupied by other players; Need a new goal.");
          await delay(100,undefined,{signal});return await executeNavigate(c,args,signal,{place,dig,replans:replans+1,segments});
        }
        // Recheck the entire segment: a block may vanish while the bot is running.
        for (let check = i; check <= last; check++) {
          const p = route.steps[check].position;
          if (!isAir(c.world.blockAt(p)) || !isAir(c.world.blockAt({ ...p, y: p.y + 1 })) || !isFullBlock(c.world.blockAt({ ...p, y: p.y - 1 })) || !volumeClearance({position:{x:p.x+.5,y:p.y,z:p.z+.5},getBlock:q=>c.world.blockAt(q)}).clear) throw new OMActionError('SUPPORT_CHANGED', "Support/The route has changed.");
        }
        if(shortcut) {
          const origin={...c.state.position,y:target.y},delta={x:target.x-origin.x,z:target.z-origin.z};
          if(!safeCorridor(origin,delta,Math.min(2,Math.hypot(delta.x,delta.z)),p=>c.world.blockAt(p)))throw new OMActionError('SUPPORT_CHANGED','The steering corridor changed.');
        }
        if(coordinated){
          const beforeWait=Date.now();
          if(await coordination.update(groundPath)){
            // Deliberate coordination waiting is not failed physical progress.
            until+=Date.now()-beforeWait;progress=createMotionProgress({timeoutMs:2500});continue;
          }
        }else coordination.release();
        c.lookAt(routeFacingTarget(c.state,segment.from,endpoint), { signal });
        const control = travelControl(c.state, target, p => c.world.blockAt(p), { sprint: args.sprint !== false, sprintJump: args.sprintJump !== false && last - i >= 7, guarding: c.guarding, brake: !continuing });
        if (bridgeWalk && c.state.onGround) {
          const foot=floor(c.state.position);
          if([-1,0,1].every(dx=>[-1,0,1].every(dz=>isFullBlock(c.world.blockAt({x:foot.x+dx,y:foot.y-1,z:foot.z+dz})))))bridgeWalk=false;
        }
        if (bridgeWalk && step.kind==='walk') { control.sneak=true; control.sprint=false; control.jump=false; }
        if (step.kind === 'jump') control.jump = c.state.position.y < target.y - .15;
        let canMove=coordinated?direction=>coordination.allows(direction)&&safeCorridor(c.state.position,direction,Math.min(1.2,Math.hypot(target.x-c.state.position.x,target.z-c.state.position.z)),p=>c.world.blockAt(p)):undefined;
        if(step.kind==='jump'){
          const dx=target.x-c.state.position.x,dz=target.z-c.state.position.z,d=Math.hypot(dx,dz)||1;
          // Personal-space steering may preserve the validated jump direction;
          // a flat-corridor check would veto every ascent near another player.
          canMove=direction=>(direction.x*dx+direction.z*dz)/d>.98;
        }
        if(step.kind==='drop'&&c.state.onGround&&c.state.position.y>target.y+.12){
          const assessment=assessFall({...fallPolicy,height:c.state.position.y-target.y,health:c.state.health,landing:c.world.blockAt({...endpoint,y:endpoint.y-1})});
          if(!assessment.allowed)throw new Error(assessment.reason);
          const dx=target.x-c.state.position.x,dz=target.z-c.state.position.z,d=Math.hypot(dx,dz)||1;
          // Only the planned fall shaft is verified; don't sidestep into a different cliff.
          canMove=direction=>(direction.x*dx+direction.z*dz)/d>.98;
          control.sprint=false;control.jump=false;
        }
        c.control = personalSpaceControl(c.state,control,[...c.entities.values()],p=>c.world.blockAt(p),c.state.entityId,{canMove,lookAhead:Math.min(1.2,Math.hypot(target.x-c.state.position.x,target.z-c.state.position.z))});
        if(!predicted){c.navigationDebug.prediction=predictMotion({state:c.state,control:c.control,getBlock:p=>c.world.blockAt(p),ticks:4}).samples;predicted=true;}
        await delay(25, undefined, { signal });
      }
      if(!continuing) {
        c.stopMovement({ sneak:bridgeWalk });
        // Edits, vertical transitions and the destination need controlled braking.
        await c.waitFor(() => Math.hypot(c.state.velocity.x, c.state.velocity.z) < .04, { signal, timeoutMs: 2000 });
      }
      let previous=segment.from;
      if(shortcut)c.emit('navigationStep',{...segment,outcome:'success',healthAfter:c.state.health,skippedWaypoints:last-i,durationMs:Date.now()-segmentStartedAt});
      else for(let learned=i;learned<=last;learned++){const current=route.steps[learned];c.emit('navigationStep',{...segment,...learnedContexts[learned-i],from:previous,to:current.position,kind:current.kind,outcome:'success',healthAfter:learned===last?c.state.health:segment.health,durationMs:Date.now()-segmentStartedAt,timingEstimated:last>i,damageEstimated:last>i});previous=current.position;}
      segment=null;
      i = last;
    }
    c.navigationDebug.status='completed';c.navigationDebug.index=route.steps.length;
  } catch(error){c.navigationDebug.status=signal.aborted?'cancelled':'failed';c.navigationDebug.reason=error.message;if(segment)c.emit('navigationStep',{...segment,outcome:signal.aborted?'cancelled':'failure',healthAfter:c.state.health,durationMs:Date.now()-segment.startedAt,reason:error.message,failureCode:error.code||'ACTION_FAILED'});throw error;
  } finally { coordination.release();c.stopMovement(); }
  if(route.partial&&Math.max(...['x','y','z'].map(k=>Math.abs(Math.floor(c.state.position[k])-Math.floor(args[k]))))>range){
    if(segments>=255||Math.hypot(c.state.position.x-start.x-.5,c.state.position.y-start.y,c.state.position.z-start.z-.5)<.5)throw new OMActionError('STUCK','The segmented route did not make bounded progress toward its goal.');
    const next=await executeNavigate(c,{...args,routeLease:undefined},signal,{place,dig,replans,segments:segments+1});
    return {...next,steps:route.steps.length+next.steps,bridgeUsed:(route.bridgeUsed||0)+(next.bridgeUsed||0),estimatedFallDamage:(route.fallDamage||0)+(next.estimatedFallDamage||0),segments:(next.segments||1)+1};
  }
  return { ok: true, position: { ...c.state.position }, steps: route.steps.length, bridgeUsed: route.bridgeUsed || 0,estimatedFallDamage:route.fallDamage||0 };
}
