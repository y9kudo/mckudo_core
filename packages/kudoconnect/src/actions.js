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
export { miningTime, chooseMiningTool } from './equipment.js';
export const KUDO_SKILLS = Object.freeze(['swim', 'menuClick', 'mount', 'dismount', 'look', 'lookAtPlayer', 'lootChest', 'select', 'equipArmor', 'prepareBed', 'sleep', 'goto', 'navigate', 'pillar', 'descendPillar', 'evade', 'dig', 'gather', 'collect', 'place', 'craft', 'smith', 'ensureStation', 'smelt', 'attack', 'combat', 'guard', 'shoot', 'drop', 'eat', 'wait', 'ignitePortal', 'fillEndFrame', 'throwEye', 'enterPortal']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const center = p => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
const name = value => { if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error('Нужен vanilla ID предмета/блока.'); return value.replace(/^minecraft:/, ''); };
const alive = (c, signal) => { signal.throwIfAborted(); if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error('Агент недоступен.'); };
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
async function select(c, itemName, signal) {
  alive(c, signal);
  if (c.containers.current || c.inventory.cursor) throw new Error('Перед сменой предмета закрой окно и освободи курсор.');
  const item = typeof itemName === 'object' ? c.inventory.slots[itemName.slot] : c.inventory.items().find(i => i.name === name(itemName));
  if (!item || typeof itemName === 'object' && item.type !== itemName.type) throw new Error('Выбранный предмет отсутствует или изменился.');
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
  return executeNavigate(c, args, signal, { place: (args, signal) => runAction(c, { skill: 'place', args }, signal), dig: (args, signal) => dig(c, args, signal) });
}
async function emptyHand(c, signal) {
  if (!c.inventory.held()) return;
  const empty = Array.from({ length: 36 }, (_, i) => 9 + i).filter(i => !c.inventory.slots[i]).sort((a,b) => Number(b >= 36) - Number(a >= 36))[0];
  if (empty === undefined) throw new Error('Для боя рукой нужен свободный слот; предметы автоматически не выбрасываются.');
  if (empty >= 36) { c.inventory.selected = empty - 36; c.write('held_item_slot', { slotId: c.inventory.selected }); }
  else {
    const revision = c.inventory.revision, heldSlot = 36 + c.inventory.selected;
    c.write('window_click', { windowId: 0, stateId: c.inventory.stateId, slot: empty, mouseButton: c.inventory.selected, mode: 2, changedSlots: [], cursorItem: { itemCount: 0 } });
    await c.waitFor(() => c.inventory.revision > revision && !c.inventory.slots[heldSlot], { signal, event: 'inventory', timeoutMs: 3000 });
  }
  c.nextAttackAt = performance.now() + 250;
}
async function approach(c, position, signal) {
  const aim = center(position), eye = () => ({ ...c.state.position, y: c.state.position.y + 1.62 });
  if (distance(eye(), aim) <= 4.3 && visible(c, aim)) return;
  const candidates = [];
  for (let dy = -4; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const p = { x: position.x + dx, y: position.y + dy, z: position.z + dz };
    if (distance({x:p.x+.5,y:p.y+1.62,z:p.z+.5},aim)>4.3) continue;
    if (isAir(c.world.blockAt(p)) && isAir(c.world.blockAt({ ...p, y: p.y + 1 })) && isFullBlock(c.world.blockAt({ ...p, y: p.y - 1 }))) candidates.push(p);
  }
  candidates.sort((a, b) => distance(a, c.state.position) - distance(b, c.state.position));
  for (const excavate of [false,true]) for (const p of candidates.slice(0, 24)) {
    const view = readRouteWorld(c.world);
    const route = await planRouteAsync({ start: floor(c.state.position), goal: p, getBlock: view.getBlock, canDig:excavate?routeCanDig(c):()=>false, maxNodes: 3000, maxDistance: 128, maxDrop: 2, signal }, { getRevision: view.getRevision });
    if (route.status !== 'planned') continue;
    await navigate(c, { ...p, range: 0, excavate, maxDrop:2, bridge:false }, signal);
    if (distance(eye(), aim) <= 4.3 && visible(c, aim)) return;
  }
  throw new Error('Нет достижимой позиции с видимостью целевого блока.');
}
async function dig(c, args, signal) {
  if (!point(args)) throw new Error('dig: нужны координаты.');
  const position = floor(args); assertEdit(c,'dig',position); await approach(c, position, signal); alive(c, signal);
  const b = c.world.blockAt(position); if (!b || args.block && name(args.block) !== b.name) throw new Error('Целевой блок отсутствует или изменился.');
  const foot = floor(c.state.position);
  if (position.x === foot.x && position.z === foot.z && position.y < foot.y) throw new Error('Добыча под собой запрещена.');
  for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const adjacent = c.world.blockAt({ x: position.x + dx, y: position.y + dy, z: position.z + dz });
    if (!adjacent || isHazard(adjacent) || dy === 1 && ['sand', 'gravel', 'anvil', 'pointed_dripstone'].includes(adjacent.name)) throw new Error('Рядом жидкость, падающий блок или неизвестная область.');
  }
  const tool = chooseMiningTool(c.registry, b, c.inventory.items(), { held: c.inventory.held(), onGround: c.state.onGround });
  if (!tool) throw new Error('Нет инструмента для получения дропа.');
  if (tool.item && tool.item.slot !== c.inventory.held()?.slot) await select(c, tool.item, signal);
  if (!tool.item) await emptyHand(c, signal);
  const timing = miningTime(c.registry, b, c.inventory.held(), { onGround: c.state.onGround });
  if (!timing.harvestable) throw new Error('Нет инструмента для получения дропа.');
  if (timing.milliseconds > 30000) throw new Error('Слишком долгая добыча без подходящего инструмента.');
  c.lookAt(center(position)); await c.waitForLook?.({ signal }); const original = b.stateId, face = 1; let complete = false;
  const started = performance.now();
  assertEdit(c,'dig',position);
  if (c.world.stateAt(position) !== original) throw new Error('Целевой блок изменился во время подготовки добычи.');
  c.write('block_dig', { status: 0, location: position, face, sequence: ++c.sequence }); c.write('arm_animation', { hand: 0 });
  try {
    await delay(timing.milliseconds, undefined, { signal }); alive(c, signal);
    assertEdit(c,'dig',position);
    if (c.world.stateAt(position) !== original) throw new Error('Целевой блок изменился во время добычи.');
    c.write('block_dig', { status: 2, location: position, face, sequence: ++c.sequence });
    await c.waitFor(() => c.world.stateAt(position) !== null && c.world.stateAt(position) !== original, { event: 'block', signal, timeoutMs: 3000 }); complete = true;
    return { ok: true, position, block: b.name, serverConfirmed: true, durationMs: performance.now() - started };
  } finally { if (!complete && c.client.state === 'play') c.write('block_dig', { status: 1, location: position, face, sequence: ++c.sequence }); }
}
async function collect(c, args, signal) {
  return executeCollect(c, args, signal, { navigate });
}
export async function runAction(c, action, signal) {
  const { skill, args = {} } = action;
  if (!KUDO_SKILLS.includes(skill)) throw new Error(`KudoConnect пока не реализует ${skill}.`);
  alive(c, signal);
  if (skill === 'swim') return executeSwim(c,args,signal);
  if (skill === 'menuClick') return clickMenu(c,args,signal);
  if (skill === 'mount') return mountVehicle(c,args,signal);
  if (skill === 'dismount') return dismountVehicle(c,signal);
  if (['ignitePortal','fillEndFrame','throwEye','enterPortal'].includes(skill)) return ({ignitePortal,fillEndFrame,throwEye,enterPortal})[skill](c,args,signal,{run:runAction,approach,select});
  if (skill === 'pillar') return pillar(c,args,signal,{select});
  if (skill === 'descendPillar') return descendPillar(c,args,signal,{select});
  if (skill === 'evade') {
    if (!point(args.from)) throw new Error('evade.from: нужна известная точка опасности.');
    const here=floor(c.state.position), candidates=[];
    for(let dx=-6;dx<=6;dx++)for(let dz=-6;dz<=6;dz++) {
      const p={x:here.x+dx,y:here.y,z:here.z+dz};
      if (Math.hypot(dx,dz)<3 || distance(p,args.from)<distance(here,args.from)+2) continue;
      if ([...c.entities.values()].some(e=>e.name==='end_crystal' && distance(p,e.position)<12 || e.name==='area_effect_cloud' && distance(p,e.position)<(e.metadata?.radius||3)+2)) continue;
      if(isAir(c.world.blockAt(p))&&isAir(c.world.blockAt({...p,y:p.y+1}))&&isFullBlock(c.world.blockAt({...p,y:p.y-1}))) candidates.push(p);
    }
    candidates.sort((a,b)=>distance(b,args.from)-distance(a,args.from));
    for(const p of candidates.slice(0,24)) {
      const view = readRouteWorld(c.world);
      if((await planRouteAsync({start:here,goal:p,getBlock:view.getBlock,maxNodes:1000,maxDistance:12,maxDrop:1,signal}, {getRevision:view.getRevision})).status==='planned') return navigate(c,{...p,range:0,bridge:false,sprintJump:false,maxDrop:1},signal);
    }
    throw new Error('Не найден известный безопасный маршрут отхода.');
  }
  if(skill==='equipArmor'){
    const itemName=name(args.item),part=['helmet','chestplate','leggings','boots'].findIndex(s=>itemName.endsWith('_'+s));
    if(part<0||!c.registry.itemsByName[itemName])throw new Error('equipArmor: нужен предмет брони.');
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
  if (skill === 'smith') return smith(c, args, signal, { run: runAction, approach });
  if (skill === 'ensureStation') return ensureStation(c, args, signal, { run: runAction, approach });
  if (skill === 'smelt') return smelt(c, args, signal, { run: runAction, approach });
  if (skill === 'prepareBed') return prepareBed(c,args,signal,{run:runAction,approach});
  if (skill === 'sleep') return sleep(c,args,signal,{run:runAction,approach});
  if (skill === 'lookAtPlayer') {
    const durationMs = args.durationMs ?? 1000;
    if (typeof args.username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(args.username) || !Number.isInteger(durationMs) || durationMs < 50 || durationMs > 30000) throw new Error('lookAtPlayer: username и durationMs 50–30000.');
    const first = c.players.entity(args.username); if (!first) throw new Error('Позиция игрока неизвестна.');
    const uuid = first.uuid, until = Date.now() + durationMs;
    while (Date.now() < until) {
      alive(c, signal); const e = c.players.entity(uuid);
      if (!e || distance(e.position, c.state.position) > 32 || !visible(c, { ...e.position, y: e.position.y + e.eyeHeight })) throw new Error('Игрок исчез, слишком далеко или скрыт препятствием.');
      c.lookAt({ ...e.position, y: e.position.y + e.eyeHeight }); await delay(50, undefined, { signal });
    }
    return { ok: true, observedPlayer: args.username, uuid, rotationSent: true };
  }
  if (skill === 'select') { await select(c, args.item, signal); return { ok: true, selected: c.inventory.selected }; }
  if (skill === 'shoot') return shoot(c, args, signal);
  if (skill === 'lootChest') return lootChest(c, args, signal);
  if (skill === 'drop') {
    const count = args.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 64 || c.inventory.count(name(args.item)) < count) throw new Error('drop: нужно 1–64 имеющихся предмета.');
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
    if (!food || c.state.food >= 20) throw new Error('eat: нужен съедобный предмет и неполная сытость.');
    await select(c, args.item, signal); const before = c.inventory.count(name(args.item)), hunger = c.state.food;
    c.write('use_item', { hand: 0, sequence: ++c.sequence, rotation: { x: c.state.yaw, y: c.state.pitch } });
    try {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) { alive(c, signal); if (c.inventory.count(name(args.item)) < before && c.state.food > hunger) return { ok: true, serverConfirmed: true }; await delay(25, undefined, { signal }); }
      throw new Error('Сервер не подтвердил потребление еды и изменение сытости.');
    } finally { if (c.client.state === 'play') c.write('block_dig', { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence }); }
  }
  if (['goto', 'navigate'].includes(skill)) return navigate(c, args, signal);
  if (skill === 'dig') return dig(c, args, signal);
  if (skill === 'collect') return collect(c, args, signal);
  if (skill === 'gather') {
    const selectors = args.block || '#logs', names = c.world.resolveSelectors([selectors]), count = args.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 16 || !names.length) throw new Error('gather: непустой класс и count 1–16.');
    const results = [];
    for (let i = 0; i < count; i++) {
      const found = await c.world.findBlocks({ names, position: c.state.position, radius: 64, count: 16, signal });
      let block, lastError;
      for (const candidate of found.blocks.filter(b=>editDecision(c,'dig',b.position).allowed)) {
        try { await approach(c, candidate.position, signal); block = candidate; break; } catch (e) { signal.throwIfAborted(); lastError = e; }
      }
      if (!block) throw lastError || new Error(`Нет достижимого блока ${selectors}.`);
      const data = c.registry.blocksByName[block.name.slice(10)], expected = args.item ? name(args.item) : c.registry.items[data.drops?.[0]]?.name;
      if (!expected) throw new Error('Для этого блока укажи ожидаемый item.');
      const before = c.inventory.count(expected);
      const result = await dig(c, { ...block.position, block: block.name }, signal);
      const pickup = await collect(c, { item: expected, beforeCount: before, origin: block.position }, signal);
      results.push({ ...result, ...pickup });
    }
    return { ok: true, blocks: results };
  }
  if (skill === 'place') {
    if (!point(args)) throw new Error('place: координаты.');
    const p = floor(args), blockName = name(args.block); assertEdit(c,'place',p); await approach(c, p, signal);
    if (!isAir(c.world.blockAt(p))) throw new Error('Место установки занято.');
    const faces = [[0, -1, 0, 1], [0, 1, 0, 0], [0, 0, -1, 3], [0, 0, 1, 2], [-1, 0, 0, 5], [1, 0, 0, 4]];
    const face = faces.find(([x, y, z]) => isFullBlock(c.world.blockAt({ x: p.x + x, y: p.y + y, z: p.z + z })));
    if (!face) throw new Error('Нет наблюдаемой опорной грани.');
    await select(c, blockName, signal); const ref = { x: p.x + face[0], y: p.y + face[1], z: p.z + face[2] };
    const cursor={x:.5-face[0]*.5,y:.5-face[1]*.5,z:.5-face[2]*.5};
    c.lookAt({x:ref.x+cursor.x,y:ref.y+cursor.y,z:ref.z+cursor.z}); await c.waitForLook?.({ signal }); assertEdit(c,'place',p);
    if (!isAir(c.world.blockAt(p)) || !isFullBlock(c.world.blockAt(ref))) throw new Error('Место установки или опора изменились во время поворота.');
    c.write('block_place', { hand: 0, location: ref, direction: face[3], cursorX: cursor.x, cursorY: cursor.y, cursorZ: cursor.z, insideBlock: false, sequence: ++c.sequence });
    await c.waitFor(() => c.world.blockAt(p)?.name === blockName, { signal, event: 'block', timeoutMs: 3000 }); rememberPlacement(c,p); return { ok: true, serverConfirmed: true };
  }
  if (skill === 'attack') {
    const e = c.entities.get(Number(args.entityId)); if (!e || e.kind === 'player' && args.allowPlayer !== true) throw new Error('Недоступная цель; PvP требует allowPlayer.');
    if (distance(e.position, c.state.position) > 3 || !visible(c, { ...e.position, y: e.position.y + 0.8 })) throw new Error('Цель вне дистанции удара или за препятствием.');
    if (performance.now() < (c.nextAttackAt || 0)) throw new Error('Оружие ещё восстанавливается.');
    c.lookAt({ ...e.position, y: e.position.y + 0.8 }); await c.waitForLook?.({ signal }); const at = performance.now();
    if(c.entities.get(Number(e.id))!==e||distance(e.position,c.state.position)>3||!visible(c,{...e.position,y:e.position.y+.8}))throw new Error('Цель переместилась за время поворота; нужен новый подход.');
    c.write('use_entity', { target: Number(e.id), mouse: 1, sneaking: false }); c.write('arm_animation', { hand: 0 });
    c.nextAttackAt = at + weaponProfile(c.inventory.held()?.name).cooldownMs;
    return { ok: true, sent: true, damageConfirmed: false, dispatchMs: performance.now() - at };
  }
  if (skill === 'combat') {
    const duration = args.durationMs ?? 400, maxDistance = args.maxDistance ?? 12;
    if (!Number.isInteger(duration) || duration < 50 || duration > 2000 || !Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 32) throw new Error('combat: неверный бюджет.');
    const target = c.entities.get(Number(args.entityId));
    if (!target || target.kind === 'player' && args.allowPlayer !== true) throw new Error('Нет разрешённой цели боя.');
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
      if (distance(c.state.position, target.position) > maxDistance) throw new Error('Цель вышла за дистанцию преследования.');
      const now=performance.now(),shield=c.inventory.slots[45]?.name==='shield'&&remainingDurability(c.inventory.slots[45],c.registry)>0;
      if(c.combatJump){if(!c.state.onGround)c.combatJump.airborne=true;if(c.combatJump.target!==target.id||now>c.combatJump.until||c.combatJump.airborne&&c.state.onGround)c.combatJump=null;}
      const jumpKey=String(target.id)+'/'+(c.nextAttackAt||0),nearby=[...c.entities.values()].filter(e=>e!==target&&e.kind==='player'&&distance(e.position,c.state.position)<3).length;
      const safeJump=args.critical!==false&&weapon&&c.state.health>12&&c.state.food>6&&!nearby&&!c.guarding&&c.state.onGround&&c.criticalAttempt!==jumpKey&&['x','z'].every(axis=>[-1,1].every(sign=>safeCorridor(c.state.position,{x:axis==='x'?sign:0,z:axis==='z'?sign:0},1,p=>c.world.blockAt(p),{headroom:4})));
      const tactic = combatDecision({ self: { ...c.state, shield,shieldDisabledUntil:c.shieldDisabledUntil }, target: { ...target,blocking:shieldFaces(target,c.state.position), charging: target.name === 'blaze' && Boolean(target.metadata.flags & 1) },
        projectiles: [...c.entities.values()].filter(e => ['arrow', 'small_fireball', 'fireball', 'trident'].includes(e.name)), nextAttackAt: c.nextAttackAt || 0, now, retreatHealth: args.retreatHealth ?? 8,criticalPending:Boolean(c.combatJump),canCriticalJump:safeJump });
      if(tactic.mode!=='retreat'){
        const pursuit=c.combatPursuit.observe({target,position:c.state.position,dimension:c.state.dimension,now,maxDistance});
        if(!pursuit.allowed){c.stopMovement();throw new Error(pursuit.reason);}
      }
      if (!['approach', 'retreat', 'strafe'].includes(tactic.mode)) c.stopMovement();
      c.lookAt({ ...target.position, y: target.position.y + 1 }, { signal, turnSpeed: 720 });
      if (tactic.mode === 'block') {c.combatJump=null;return runAction(c, { skill: 'guard', args: { entityId:target.id,durationMs: Math.max(250, Math.min(600, until - Date.now())) } }, signal);}
      if (tactic.mode === 'jump') {c.combatJump||={target:target.id,until:now+1500,airborne:false};c.criticalAttempt=jumpKey;c.control={x:0,z:0,jump:true,sprint:false};}
      if (tactic.mode === 'strike') {if(avoidSweep&&weaponProfile(c.inventory.held()?.name).kind==='sword'&&!tactic.critical)throw new Error('Рядом с целью посторонний игрок: массовый удар мечом небезопасен.');await runAction(c, { skill: 'attack', args: { entityId: target.id, allowPlayer: args.allowPlayer === true } }, signal);c.combatPursuit.attackSent(performance.now());c.combatJump=null;}
      if (['approach', 'retreat', 'strafe'].includes(tactic.mode)) {
        c.control = tactic.mode==='approach'?await combatApproach(c,target,signal):combatControl(c.state, target.position, tactic.mode, p => c.world.blockAt(p), { guarding: c.guarding, strafeSide: Math.floor(Date.now() / 1800) % 2 ? -1 : 1 });
      }
      await delay(25, undefined, { signal });
    }
    return { ok: true, frameFinished: true };
  }
  if (skill === 'guard') {
    const duration = args.durationMs ?? 400; if (!Number.isInteger(duration) || duration < 50 || duration > 2000) throw new Error('guard.durationMs: 50–2000.');
    if(performance.now()<(c.shieldDisabledUntil||0))throw new Error('Сервер временно отключил щит.');
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
    if (!e || e.kind === 'player' && args.allowPlayer !== true) throw new Error('Нет разрешённой цели выстрела; PvP требует allowPlayer.');
    if(e.name==='end_crystal' && distance(c.state.position,e.position)<12)throw new Error('Выстрел по кристаллу требует дистанции не менее 12 блоков.');
    if(e.name==='ender_dragon' && [5,6,7,9].includes(e.metadata?.phase))throw new Error('Дракон сидит или погибает: выстрел сейчас не нужен.');
    return e;
  };
  target(); await select(c, weapon, signal); c.stopMovement();
  const loaded = () => c.inventory.held()?.raw.components?.find(p => p.type === 'charged_projectiles')?.data?.projectiles || [];
  const ammunition = () => c.inventory.count('arrow') + c.inventory.count('spectral_arrow') + c.inventory.count('tipped_arrow');
  if (!ammunition() && !(weapon === 'crossbow' && loaded().length)) throw new Error('Нет стрел.');
  const aim = () => {
    const e = target(), s = c.state;
    const solution = solveAim({ origin: { ...s.position, y: s.position.y + 1.52 }, target: { ...e.position, y: e.position.y + (c.registry.entitiesByName[e.name]?.height ?? 1.8) / 2 }, targetVelocity: e.velocity,
      inheritedVelocity: { x: s.velocity.x, y: s.onGround ? 0 : s.velocity.y, z: s.velocity.z }, weapon, chargeTicks, getBlock: p => c.world.blockAt(p) });
    if (solution.status !== 'aimed') throw new Error(`Нет траектории: ${solution.reason}.`);
    return solution;
  };
  const turn=async()=>{
    for(let i=0;i<4;i++){
      const solution=aim(),yaw=solution.yaw*Math.PI/180,pitch=solution.pitch*Math.PI/180,s=c.state;
      c.lookAt({x:s.position.x-Math.sin(yaw)*Math.cos(pitch)*20,y:s.position.y+1.62-Math.sin(pitch)*20,z:s.position.z+Math.cos(yaw)*Math.cos(pitch)*20},{signal,turnSpeed:720});
      await c.waitForLook({signal});
      const fresh=aim();
      if(Math.hypot(wrapDegrees(fresh.yaw-c.state.yaw),fresh.pitch-c.state.pitch)<1)return fresh;
    }
    throw new Error('Цель сместилась при наведении; нужен новый выстрел.');
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
    alive(c, signal); const solution = await turn(), ammoBefore = ammunition(), priorEntities = new Set(c.entities.keys());
    if (weapon === 'crossbow' && loaded().some(raw => !['arrow', 'spectral_arrow', 'tipped_arrow'].includes(c.registry.items[raw.itemId]?.name))) throw new Error('Для этой баллистики арбалет должен содержать стрелы.');
    if (weapon === 'bow') c.write('block_dig', { status: 5, location: { x: 0, y: 0, z: 0 }, face: 0, sequence: ++c.sequence });
    else use();
    released = true; using = false;
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      alive(c, signal);
      const projectile = [...c.entities].find(([id, e]) => !priorEntities.has(id) && ['arrow', 'spectral_arrow'].includes(e.name) && e.ownerId === c.state.entityId);
      if (projectile || weapon === 'bow' && ammunition() < ammoBefore || weapon === 'crossbow' && !loaded().length) return { ok: true, shotServerConfirmed: true, hitConfirmed: false, projectileId: projectile?.[0] ?? null, flightTicks: solution.ticks, yaw: solution.yaw, pitch: solution.pitch };
      await delay(25, undefined, { signal });
    }
    throw new Error('Выстрел отправлен, но сервер не подтвердил снаряд или расход боезапаса. Не повторять автоматически.');
  } finally {
    // Switching slots cancels a drawn bow without releasing its arrow at the old target.
    if (using && !released && c.client.state === 'play') {
      c.write('held_item_slot', { slotId: (originalSlot + 1) % 9 }); c.write('held_item_slot', { slotId: originalSlot });
    }
  }
}

async function lootChest(c, args, signal) {
  if (!point(args)) throw new Error('lootChest: нужны x/y/z.');
  const maxStacks = args.maxStacks ?? 54;
  if (!Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > 54 || args.items !== undefined && (!Array.isArray(args.items) || !args.items.length || args.items.length > 128)) throw new Error('lootChest: maxStacks 1–54, items — список ID.');
  const allowed = args.items?.map(name), position = floor(args), transferred = [];
  if (c.containers.current) throw new Error('Уже открыто другое окно.');
  await approach(c, position, signal);
  if (!isStorageBlock(c.world.blockAt(position)?.name)) throw new Error('Здесь нет наблюдаемого хранилища.');
  const identity = storageIdentity(c.world,position);
  if (c.inventory.cursor) throw new Error('Сначала освободи предмет на курсоре.');
  c.lookAt(center(position)); await c.waitForLook?.({ signal }); let opened = false;
  c.containerRequest = true;
  try {
    c.write('block_place', { hand: 0, location: position, direction: 1, cursorX: .5, cursorY: .5, cursorZ: .5, insideBlock: false, sequence: ++c.sequence });
    await c.waitFor(() => Boolean(c.containers.current?.ready), { signal, event: 'container', timeoutMs: 4000 }); opened = true;
    const w = c.containers.current; let reason = 'empty-or-filtered';
    for (let i = 0; i < maxStacks; i++) {
      alive(c, signal); if (c.containers.current !== w) throw new Error('Сервер закрыл или заменил окно.');
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
