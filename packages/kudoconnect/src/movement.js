import { setTimeout as delay } from 'node:timers/promises';
import { planRoute, isAir, isFullBlock, isHazard } from './navigation.js';
import { gazeAngles } from './players.js';
import {assessFall} from './fall.js';

const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const validPoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
export const wrapDegrees = angle => ((angle + 180) % 360 + 360) % 360 - 180;

/** Degrees and seconds; yaw follows the shortest arc, with bounded, eased rotation. */
export function rotateToward(state, angles, { turnSpeed = 540, dt = .05 } = {}) {
  if (![state.yaw, state.pitch, angles.yaw, angles.pitch, turnSpeed, dt].every(Number.isFinite) || turnSpeed < 30 || turnSpeed > 1440 || dt < 0) throw new Error('Некорректные параметры поворота.');
  const elapsed = Math.min(.1, dt), limit = turnSpeed * elapsed, easing = 1 - Math.exp(-14 * elapsed);
  const advance = error => Math.abs(error) < .1 ? error : Math.sign(error) * Math.min(Math.abs(error) * easing, limit);
  return { yaw: wrapDegrees(state.yaw + advance(wrapDegrees(angles.yaw - state.yaw))), pitch: Math.max(-90, Math.min(90, state.pitch + advance(angles.pitch - state.pitch))) };
}

export class SmoothLook {
  target = null;
  set(state, target, { signal, turnSpeed = 540, immediate = false } = {}) {
    signal?.throwIfAborted();
    if (!validPoint(state.position) || !validPoint(target) || !Number.isFinite(turnSpeed) || turnSpeed < 30 || turnSpeed > 1440) throw new Error('lookAt: известная позиция, цель и turnSpeed 30–1440.');
    this.target = { position: { ...target }, turnSpeed, signal };
    if (immediate) { Object.assign(state, this.angles(state)); this.clear(); }
  }
  angles(state) { return gazeAngles({ ...state.position, y: state.position.y + 1.62 }, this.target.position); }
  tick(state, dt = .05) {
    if (!this.target) return;
    if (this.target.signal?.aborted || !state.position) { this.clear(); return; }
    const angles = this.angles(state);
    Object.assign(state, rotateToward(state, angles, { turnSpeed: this.target.turnSpeed, dt }));
    if (Math.hypot(wrapDegrees(angles.yaw - state.yaw), angles.pitch - state.pitch) < .1) { Object.assign(state, angles); this.clear(); }
  }
  clear() { this.target = null; }
}

/** The fallback rotates only; it never runs extra physics ticks or changes position. */
export async function waitForLook(client, { signal = client.pending?.signal, timeoutMs = 3000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) throw new Error('waitForLook: timeoutMs 50–10000.');
  const target = client.look.target, until = Date.now() + timeoutMs;
  while (target && client.look.target === target) {
    signal?.throwIfAborted(); target.signal?.throwIfAborted();
    if (Date.now() > until) throw new Error('Истёк бюджет поворота к цели.');
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
export function bridgeMaterials(registry, items, { blockAtState, itemValue = baseBridgeValue, reserve = 0 } = {}) {
  if (typeof itemValue !== 'function' || !Number.isInteger(reserve) || reserve < 0) throw new Error('Материалы моста: itemValue и reserve.');
  const result = [];
  for (const item of items) {
    const name = (item.name || item.item || '').replace(/^minecraft:/, ''), data = registry.blocksByName[name];
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
  for (let t = 0; t <= length + .001; t += .2) {
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

export function travelControl(state, target, getBlock, { sprint = true, sprintJump = true, guarding = false, longDistance = 8 } = {}) {
  const dx = target.x - state.position.x, dz = target.z - state.position.z, d = Math.hypot(dx, dz);
  if (d < .04) return { x: 0, z: 0, jump: false, sprint: false };
  const direction = { x: dx / d, z: dz / d }, desired = gazeAngles(state.position, { ...target, y: state.position.y });
  const facing = Math.abs(wrapDegrees(desired.yaw - (state.yaw || 0))) < 35;
  const airborneRun = state.sprinting && !state.onGround && state.position.y >= target.y && state.position.y - target.y <= 1.6;
  const supportPosition = airborneRun ? { ...state.position, y: target.y } : state.position;
  const safe = d >= 1.5 && safeCorridor(supportPosition, direction, Math.min(d, 2), getBlock, { headroom: airborneRun ? 4 : 2 });
  const running = Boolean(sprint && state.food > 6 && !guarding && facing && safe && !state.horizontalCollision);
  // Braking preserves server physics: reduce input, never edit position or velocity.
  const speed = d < .8 ? Math.max(.08, Math.min(.7, d * 1.5)) : 1;
  return { x: direction.x * speed, z: direction.z * speed, sprint: running,
    jump: Boolean(running && sprintJump && state.onGround && d >= longDistance && safeCorridor(state.position, direction, 6, getBlock, { headroom: 4 })) };
}

export function combatControl(state, target, mode, getBlock, { guarding = false, strafeSide = 1 } = {}) {
  const dx = target.x - state.position.x, dz = target.z - state.position.z, d = Math.hypot(dx, dz) || 1;
  const forward = { x: dx / d, z: dz / d }, side = { x: forward.z * strafeSide, z: -forward.x * strafeSide };
  const options = mode === 'retreat' ? [{ x: -forward.x, z: -forward.z }, side, { x: -side.x, z: -side.z }] : mode === 'strafe' ? [side, { x: -side.x, z: -side.z }] : mode === 'approach' ? [forward, side, { x: -side.x, z: -side.z }] : [];
  for (const direction of options) {
    if (!safeCorridor(state.position, direction, 1.3, getBlock)) continue;
    const control = travelControl(state, { x: state.position.x + direction.x * (mode === 'approach' ? d : 2), y: state.position.y, z: state.position.z + direction.z * (mode === 'approach' ? d : 2) }, getBlock, { guarding, sprintJump: false });
    // Sprinting while facing the enemy only makes sense when closing the gap.
    return { ...control, sprint: mode === 'approach' && d > 4 && control.sprint, jump: false };
  }
  return { x: 0, z: 0, jump: false, sprint: false };
}

export function personalSpaceControl(state,control,entities,getBlock,ownId,{canMove}={}){
  if(!state.onGround)return control;
  const peers=entities.filter(e=>e.kind==='player'&&String(e.id)!==String(ownId)&&e.position&&Math.abs(e.position.y-state.position.y)<1.8&&Math.hypot(e.position.x-state.position.x,e.position.z-state.position.z)<3);
  if(!peers.length)return control;
  let x=control.x,z=control.z;
  for(const e of peers){let dx=state.position.x-e.position.x,dz=state.position.z-e.position.z,d=Math.hypot(dx,dz);if(d<1){if(d<.01){dx=String(ownId)<String(e.id)?1:-1;dz=0;d=1;}const push=(1.1-Math.min(d,1))/.4;x+=dx/d*push;z+=dz/d*push;}}
  const size=Math.hypot(x,z);if(!size)return {...control,x:0,z:0,sprint:false,jump:false};
  for(const angle of [0,.7,-.7,1.4,-1.4,Math.PI]){
    const direction={x:(x*Math.cos(angle)-z*Math.sin(angle))/size,z:(x*Math.sin(angle)+z*Math.cos(angle))/size};
    const threatened=peers.some(e=>{const dx=e.position.x-state.position.x,dz=e.position.z-state.position.z,t=Math.max(0,Math.min(1.2,dx*direction.x+dz*direction.z));return Math.hypot(dx-direction.x*t,dz-direction.z*t)<.75&&dx*direction.x+dz*direction.z>0;});
    if(!threatened&&(canMove?canMove(direction):safeCorridor(state.position,direction,1.2,getBlock)))return {...control,x:direction.x*Math.min(1,size),z:direction.z*Math.min(1,size),sprint:false,jump:false};
  }
  return {x:0,z:0,sprint:false,jump:false};
}

export async function executeNavigate(c, args, signal, { place, dig, replans=0 } = {}) {
  if (!validPoint(args)) throw new Error('Навигация: нужны x/y/z.');
  const range = args.range ?? 1;
  if (!Number.isInteger(range) || range < 0 || range > 8) throw new Error('range: 0–8.');
  const alive = () => { signal.throwIfAborted(); if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error('Агент недоступен.'); };
  alive();
  const materials = () => bridgeMaterials(c.registry, c.inventory.items(), { blockAtState: id => c.world.Block?.fromStateId(id, 0), itemValue: c.options?.bridgeItemValue || baseBridgeValue, reserve: c.options?.bridgeReserve ?? 0 });
  const blocks = args.bridge === false ? [] : materials(), budget = Math.min(256, blocks.reduce((sum, b) => sum + b.count, 0));
  const occupied=p=>[...c.entities.values()].some(e=>e.kind==='player'&&Math.abs(e.position.y-p.y)<1.8&&Math.hypot(e.position.x-(p.x+.5),e.position.z-(p.z+.5))<.8);
  const fallPolicy={health:c.state.health,minHealthAfter:c.options?.fallHealthReserve??6,maxDamage:c.options?.maxFallDamage??6};
  const route = planRoute({ start: floor(c.state.position), goal: floor(args), range, occupied, getBlock: p => c.world.blockAt(p), maxDistance: 128, maxNodes: 12000, maxDrop:args.maxDrop??c.options?.maxDrop??16,fallPolicy,
    bridgeBudget: typeof place === 'function' ? budget : 0, bridgeBlock: blocks[0]?.block || 'minecraft:cobblestone' });
  if (route.status !== 'planned') throw new Error(route.reason);
  const corrections = c.metrics.corrections;
  try {
    for (let i = 0; i < route.steps.length; i++) {
      alive(); const step = route.steps[i];
      if (step.kind === 'bridge') {
        c.stopMovement();
        // Wait for ordinary friction before opening a placement operation at an edge.
        await c.waitFor(() => Math.hypot(c.state.velocity.x, c.state.velocity.z) < .025 && c.state.onGround, { signal, timeoutMs: 2000 });
        const block = materials()[0]; if (!block || !place) throw new Error('Нет безопасных блоков для продолжения моста.');
        await place({ ...step.position, block: block.block }, signal);
        if (!isFullBlock(c.world.blockAt(step.position))) throw new Error('Сервер не подтвердил опору моста.');
        continue;
      }
      if (step.kind === 'dig') { if (!dig) throw new Error('Нет обработчика добычи маршрута.'); c.stopMovement(); await dig({ ...step.position, block: step.expected }, signal); continue; }
      // Merge a straight, flat run so velocity and jumping survive voxel boundaries.
      let last = i;
      if (step.kind === 'walk') {
        const previous = i > 0 && ['walk', 'jump', 'drop'].includes(route.steps[i - 1].kind) ? route.steps[i - 1].position : floor(c.state.position);
        const dx = step.position.x - previous.x, dz = step.position.z - previous.z;
        while (last + 1 < route.steps.length) {
          const a = route.steps[last], b = route.steps[last + 1];
          if (b.kind !== 'walk' || b.position.y !== a.position.y || b.position.x - a.position.x !== dx || b.position.z - a.position.z !== dz) break;
          last++;
        }
      }
      const endpoint = route.steps[last].position, target = { x: endpoint.x + .5, y: endpoint.y, z: endpoint.z + .5 }, until = Date.now() + 5000 + (last - i) * 700;
      while (Math.hypot(c.state.position.x - target.x, c.state.position.z - target.z) > .18 || Math.abs(c.state.position.y - target.y) > .12 || !c.state.onGround) {
        alive(); if (Date.now() > until) throw new Error('Истёк бюджет движения по шагу.');
        if (c.metrics.corrections - corrections > 2) throw new Error('Сервер несколько раз скорректировал движение; маршрут остановлен.');
        if(c.state.onGround&&route.steps.slice(i,last+1).some(s=>occupied(s.position)&&Math.hypot(s.position.x+.5-c.state.position.x,s.position.z+.5-c.state.position.z)>.9)){
          c.stopMovement();if(replans>=4)throw new Error('Маршрут занят другими игроками; требуется новая цель.');
          await delay(100,undefined,{signal});return await executeNavigate(c,args,signal,{place,dig,replans:replans+1});
        }
        // Recheck the entire segment: a block may vanish while the bot is running.
        for (let check = i; check <= last; check++) {
          const p = route.steps[check].position;
          if (!isAir(c.world.blockAt(p)) || !isAir(c.world.blockAt({ ...p, y: p.y + 1 })) || !isFullBlock(c.world.blockAt({ ...p, y: p.y - 1 }))) throw new Error('Опора/проход маршрута изменились.');
        }
        c.lookAt({ ...target, y: target.y + 1.62 }, { signal });
        const control = travelControl(c.state, target, p => c.world.blockAt(p), { sprint: args.sprint !== false, sprintJump: args.sprintJump !== false && last - i >= 7, guarding: c.guarding });
        if (step.kind === 'jump') control.jump = c.state.position.y < target.y - .15;
        let canMove;
        if(step.kind==='drop'&&c.state.onGround&&c.state.position.y>target.y+.12){
          const assessment=assessFall({...fallPolicy,height:c.state.position.y-target.y,health:c.state.health,landing:c.world.blockAt({...endpoint,y:endpoint.y-1})});
          if(!assessment.allowed)throw new Error(assessment.reason);
          const dx=target.x-c.state.position.x,dz=target.z-c.state.position.z,d=Math.hypot(dx,dz)||1;
          // Only the planned fall shaft is verified; don't sidestep into a different cliff.
          canMove=direction=>(direction.x*dx+direction.z*dz)/d>.98;
          control.sprint=false;control.jump=false;
        }
        c.control = personalSpaceControl(c.state,control,[...c.entities.values()],p=>c.world.blockAt(p),c.state.entityId,{canMove});
        await delay(25, undefined, { signal });
      }
      c.stopMovement();
      // Absorb remaining inertia before turning or placing blocks at the next step.
      await c.waitFor(() => Math.hypot(c.state.velocity.x, c.state.velocity.z) < .04, { signal, timeoutMs: 2000 });
      i = last;
    }
  } finally { c.stopMovement(); }
  return { ok: true, position: { ...c.state.position }, steps: route.steps.length, bridgeUsed: route.bridgeUsed || 0,estimatedFallDamage:route.fallDamage||0 };
}
