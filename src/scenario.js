import { jsonCopy } from './config.js';
import { createBlockTaxonomy } from './taxonomy.js';
import { createResourceReactor, planExploration } from './exploration.js';
import { createNetherPortalBlueprint, planNetherPortal, triangulateEyes, fortressEvidence, dragonDecision } from './endgame.js';
import {blockKey,createGroundShelterBlueprint,findGroundShelterSite,planConstruction} from './construction.js';
const fields = { resources: ['targets'], shelter:[], swim:['position'], navigate: ['position','range','bridge','excavate'], collect: ['item', 'count'], netherPortal: ['origin', 'axis'], travel: ['dimension'], blazeRods: ['count'], enderPearls: ['count'], eyes: ['count'], stronghold: [], endPortal: [], dragon: [] };
const namespaced = s => typeof s === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s);
export function validateScenario(input) {
  const s = jsonCopy(input);
  const keys = (o, allowed, path) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !allowed.includes(k))) throw new Error(`${path}: неизвестное поле или неверный объект.`); };
  keys(s, ['schemaVersion', 'name', 'steps'], 'scenario');
  if (s.schemaVersion !== 1 || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || !Array.isArray(s.steps) || !s.steps.length || s.steps.length > 64) throw new Error('Сценарий: schemaVersion 1, name и 1–64 steps.');
  const ids = new Set();
  for (const step of s.steps) {
    if (!step || !Object.hasOwn(fields, step.type)) throw new Error(`Неизвестный тип этапа: ${step?.type}.`);
    keys(step, ['id', 'type', ...fields[step.type]], `steps.${step.id}`);
    if (typeof step.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(step.id) || ids.has(step.id)) throw new Error('У этапов должны быть уникальные id: a-z, 0-9, _ или -.');
    ids.add(step.id);
    if (step.type === 'resources') {
      if (!step.targets || typeof step.targets !== 'object' || Array.isArray(step.targets) || !Object.keys(step.targets).length || Object.keys(step.targets).length > 32 || Object.entries(step.targets).some(([k, n]) => !(namespaced(k) || /^#[a-z0-9_:.-]+$/.test(k)) || !Number.isInteger(n) || n < 1 || n > 4096)) throw new Error('resources.targets: ID/#класс и количество 1–4096.');
    }
    if(step.type==='navigate'||step.type==='swim'){
      keys(step.position,['x','y','z'],`steps.${step.id}.position`);
      if(!['x','y','z'].every(k=>Number.isInteger(step.position[k])&&Math.abs(step.position[k])<=30000000))throw new Error('navigate.position: целые координаты x, y, z в пределах мира.');
      if(step.range!==undefined&&(!Number.isInteger(step.range)||step.range<0||step.range>8))throw new Error('navigate.range: целое число 0–8.');
      for(const k of ['bridge','excavate'])if(step[k]!==undefined&&typeof step[k]!=='boolean')throw new Error(`navigate.${k}: true или false.`);
    }
    if (['collect', 'blazeRods', 'enderPearls', 'eyes'].includes(step.type) && (!Number.isInteger(step.count) || step.count < 1 || step.count > 64)) throw new Error(`${step.type}.count: 1–64.`);
    if (step.type === 'collect' && !namespaced(step.item)) throw new Error('collect.item: namespace:id.');
    if (step.type === 'netherPortal' && step.origin) createNetherPortalBlueprint(step);
    if (step.type === 'netherPortal' && step.axis !== undefined && !['x', 'z'].includes(step.axis)) throw new Error('axis: x или z.');
    if (step.type === 'travel' && !['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].includes(step.dimension)) throw new Error('Неизвестное измерение travel.dimension.');
  }
  return s;
}

/** A scenario is a reactor/controller, not a Minecraft client. The application owns both. */
export function createScenario({ scenario, catalog, taxonomy = createBlockTaxonomy(catalog), stations = {}, getBlock, explorationRadius = 24, resourceFactory, navigationFactory, strongholdSearch, dragonCombat, explorationPlanner }) {
  const definition = validateScenario(scenario), completed = [], resources = new Map(), origins = new Map(), shelters=new Map(), visited = [], portals = new Map();
  const navigation=new Map();
  let index = 0, activeResource = null, activeNavigation=null, state = { status: 'pending', current: definition.steps[0].id, completed: [], reason: 'Ожидание наблюдения.' };
  const idle = reason => ({ action: null, reason: String(reason).slice(0, 500) });
  const act = (skill, args, reason, priority = 10) => ({ action: { skill, args }, reason, priority });
  const nameAt = p => { const b = getBlock?.(p); return b ? b.id || (b.name?.includes(':') ? b.name : 'minecraft:' + b.name) : null; };
  const supply = (stepId, targets, o) => {
    const key = stepId + JSON.stringify(targets);
    if (!resources.has(key)) resources.set(key, resourceFactory ? resourceFactory(targets) : createResourceReactor({ catalog, taxonomy, targets, stations, exploration: getBlock ? { getBlock, radius: explorationRadius, mode: 'ores' } : undefined }));
    activeResource=resources.get(key);
    return resources.get(key).react(o);
  };
  const enough = (targets, inventory) => Object.entries(targets).every(([id, n]) => (id.startsWith('#') ? taxonomy.members(id.slice(1)).reduce((sum, item) => sum + (inventory[item] || 0), 0) : inventory[id] || 0) >= n);
  const explore = (o, mode = 'surface', toward) => {
    if (!getBlock || !o.self?.position) return idle('Для исследования подключи getBlock(position).');
    const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(o.self.position[k])]));
    if (!visited.some(v => blockKey(v) === blockKey(p))) { visited.push(p); if (visited.length > 256) visited.shift(); }
    const args = { getBlock, position: p, visited, radius: explorationRadius, mode, ...(toward ? { candidateCost: q => Math.min(1000, Math.max(0, 32 + Math.hypot(q.x-toward.x,q.z-toward.z)-Math.hypot(p.x-toward.x,p.z-toward.z))) } : {}) };
    const route = explorationPlanner ? explorationPlanner.poll({ ...args, context: 'scenario:' + definition.steps[index]?.id }) : planExploration(args);
    return route.status === 'planned' ? act('navigate', route.target, route.reason) : idle(route.reason);
  };
  const collect = (item, o) => {
    const drop = o.drops?.find(d => d.item === item);
    return drop ? act('collect', { item, origin: drop.position, radius: 12, timeoutMs: 8000 }, `Подобрать ${item} с подтверждением инвентарём.`, 100) : null;
  };
  const seekLoot = (item, mob, n, o) => {
    if ((o.inventory[item] || 0) >= n) return null;
    const pickup = collect(item, o); if (pickup) return pickup;
    const target = (o.entities || []).find(e => e.name === mob && e.kind !== 'player' && Math.hypot(e.position.x - o.self.position.x, e.position.y - o.self.position.y, e.position.z - o.self.position.z) <= 32);
    if (target) {
      if(Math.hypot(target.position.x-o.self.position.x,target.position.y-o.self.position.y,target.position.z-o.self.position.z)>2.8)return act('navigate',{...Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(target.position[k])])),range:1,bridge:false,sprintJump:false},`Подойти к наблюдаемому ${mob}.`,100);
      return act('combat', { entityId: target.id, maxDistance: 4, durationMs: 600 }, `Добыча ${item}: бой с наблюдаемым ${mob}.`, 100);
    }
    return explore(o);
  };
  const reactStep = (step, o) => {
    if(step.type==='swim'){
      const p=o.self?.position,target={x:step.position.x+.5,y:step.position.y+.05,z:step.position.z+.5};
      if(!p)return idle('Для плавания нужна наблюдаемая позиция.');
      if(Math.hypot(p.x-target.x,p.y-target.y,p.z-target.z)<.55)return null;
      return act('swim',{position:step.position},'Пройти водный маршрут KudoVectorize с контролем воздуха.');
    }
    const inv = o.inventory || {}, blocks = o.world?.sampledBlocks || [];
    if(step.type==='navigate'){
      if(!navigationFactory)return idle('Для этапа navigate подключи navigationFactory; createMinecraftAgent подключает её автоматически.');
      if(!navigation.has(step.id))navigation.set(step.id,navigationFactory(step));
      activeNavigation=navigation.get(step.id);
      return activeNavigation.react(o);
    }
    if (step.type === 'resources') {
      const owned={...inv};for(const item of Object.values(o.equipment||{}))if(item)owned[item.item]=(owned[item.item]||0)+item.count;
      return enough(step.targets, owned) ? null : supply(step.id, step.targets, o);
    }
    if(step.type==='shelter'){
      if(o.dimension!=='minecraft:overworld'||!getBlock)return idle('Для строительства дома нужны наблюдаемые блоки обычного мира.');
      let blueprint=shelters.get(step.id);
      if(!blueprint){
        const site=findGroundShelterSite({near:o.self.position,getBlock});
        if(!site)return explore(o,'surface');
        const nearestLog=blocks.filter(b=>/_log$/.test(b.name)).sort((a,b)=>Math.hypot(a.position.x-o.self.position.x,a.position.z-o.self.position.z)-Math.hypot(b.position.x-o.self.position.x,b.position.z-o.self.position.z))[0]?.name;
        const heldWood=Object.entries(inv).filter(([id,n])=>n>0&&/_(?:log|planks)$/.test(id)).sort((a,b)=>b[1]-a[1])[0]?.[0];
        const wood=(nearestLog||heldWood||'minecraft:oak_log').replace(/^minecraft:/,'').replace(/_(?:log|planks)$/,'');
        blueprint=createGroundShelterBlueprint({origin:site,material:`minecraft:${wood}_planks`,door:`minecraft:${wood}_door`});shelters.set(step.id,blueprint);
      }
      const siteBlocks=Object.fromEntries([...blueprint.cells,...blueprint.air,...blueprint.dependent].map(p=>[blockKey(p),nameAt(p)]));
      const plan=planConstruction(blueprint,{blocks:siteBlocks,inventory:inv});
      if(plan.status==='completed')return null;
      if(plan.status==='blocked')return idle(plan.reason);
      if(plan.status==='needs-materials')return supply(step.id,Object.fromEntries(Object.entries(plan.shortages).map(([id,n])=>[id,(inv[id]||0)+n])),o);
      const next=plan.actions[0];return act(next.skill,next.args,'Построить наблюдаемый дом с дверью и крышей.');
    }
    if (step.type === 'collect') return inv[step.item] >= step.count ? null : collect(step.item, o) || idle(`В наблюдении нет выпавшего ${step.item}.`);
    if (step.type === 'eyes') return inv['minecraft:ender_eye'] >= step.count ? null : supply(step.id, { 'minecraft:ender_eye': step.count }, o);
    if (step.type === 'blazeRods') {
      if (inv['minecraft:blaze_rod'] >= step.count) return null;
      if (o.dimension !== 'minecraft:the_nether') return idle('Для поиска ифритов сначала войди в Nether.');
      const evidence = fortressEvidence(o);
      if (!evidence.blazes.length && evidence.blocks.length) {
        const p = evidence.blocks[0].position;
        if (Math.hypot(p.x - o.self.position.x, p.z - o.self.position.z) > 8) return act('goto', { ...p, range: 4 }, 'Исследовать наблюдаемые блоки возможной крепости.');
      }
      return seekLoot('minecraft:blaze_rod', 'blaze', step.count, o);
    }
    if (step.type === 'enderPearls') return seekLoot('minecraft:ender_pearl', 'enderman', step.count, o);
    if (step.type === 'netherPortal') {
      if (!['minecraft:overworld', 'minecraft:the_nether'].includes(o.dimension)) return idle('Для рамы Nether-портала нужно другое измерение.');
      if (!origins.has(step.id)) {
        let origin = step.origin;
        const base = o.self.position;
        if (!origin && getBlock) for (let dx = 3; dx <= 10 && !origin; dx++) for (let dz = -5; dz <= 5; dz++) {
          const p = { x: Math.floor(base.x) + dx, y: Math.floor(base.y), z: Math.floor(base.z) + dz }, b = createNetherPortalBlueprint({ origin: p, axis: step.axis });
          if ([...b.cells, ...b.air].every(c => ['minecraft:air', 'minecraft:cave_air'].includes(nameAt(c))) && b.cells.filter(c => c.y === p.y).every(c => getBlock({ ...c, y: c.y - 1 })?.boundingBox === 'block')) { origin = p; break; }
        }
        if (!origin) return idle('Нет наблюдаемого свободного участка 4×5 с опорой для портала. Можно задать origin.');
        origins.set(step.id, origin);
      }
      const b = createNetherPortalBlueprint({ origin: origins.get(step.id), axis: step.axis });
      const observed = Object.fromEntries([...b.cells, ...b.air].map(p => [blockKey(p), o.world?.blocks?.[blockKey(p)] ?? nameAt(p)]));
      const plan = planNetherPortal({ blueprint: b, blocks: observed, inventory: inv });
      if (plan.status === 'completed') return null;
      if (plan.status === 'needs-materials') return supply(step.id, Object.fromEntries(Object.entries(plan.shortages).map(([id, n]) => [id, (inv[id] || 0) + n])), o);
      return plan.actions.length ? act(plan.actions[0].skill, plan.actions[0].args, 'Постройка и проверка Nether-портала.') : idle(plan.reason);
    }
    if (step.type === 'travel') {
      if (o.dimension === step.dimension) return null;
      const expected = step.dimension === 'minecraft:the_end' ? 'minecraft:end_portal' : 'minecraft:nether_portal';
      const portal = blocks.find(b => b.name === expected);
      if (portal) return act('enterPortal', { ...portal.position, dimension: step.dimension }, 'Войти в подтверждённый активный портал.');
      const remembered = [...portals.values()].filter(b => b.dimension === o.dimension && b.name === expected).sort((a,b)=>Math.hypot(a.position.x-o.self.position.x,a.position.z-o.self.position.z)-Math.hypot(b.position.x-o.self.position.x,b.position.z-o.self.position.z))[0];
      if (remembered) {
        const p=remembered.position, actual=getBlock?.(p);
        // Never enter an old coordinate without confirming the current block.
        if (actual && nameAt(p) === expected && Math.hypot(p.x-o.self.position.x,p.y-o.self.position.y,p.z-o.self.position.z)<=96) return act('enterPortal', {...p,dimension:step.dimension}, 'Вернуться в ранее наблюдаемый и повторно проверенный портал.');
        return explore(o,'surface',p);
      }
      return idle(`В наблюдаемой области нет ${expected}.`);
    }
    if (step.type === 'stronghold') {
      if (o.dimension !== 'minecraft:overworld') return idle('Крепость ищут в overworld.');
      if (blocks.some(b => b.name === 'minecraft:end_portal_frame')) return null;
      const flights = o.endgame?.eyes || [], recent = flights.slice(-4), last = flights.at(-1), here = o.self.position;
      if (!last || Math.hypot(here.x - last.launched.x, here.z - last.launched.z) >= 48) {
        if (!(inv['minecraft:ender_eye'] > 0)) return idle('Для следующего измерения направления нужно око Эндера.');
        return act('throwEye', {}, 'Наблюдать полёт собственного ока.');
      }
      const estimate = triangulateEyes(recent);
      if (estimate.status === 'estimated' && Math.hypot(here.x - estimate.position.x, here.z - estimate.position.z) < 24) return strongholdSearch?.(o,estimate.position) || explore(o, 'ores');
      const dx = last.end.x - last.origin.x, dz = last.end.z - last.origin.z, length = Math.hypot(dx, dz);
      if (length < 2) return explore(o, 'ores');
      const direction = estimate.status === 'estimated' ? { x: estimate.position.x - here.x, z: estimate.position.z - here.z } : { x: dx / length * 48 - dz / length * 32, z: dz / length * 48 + dx / length * 32 };
      const d = Math.hypot(direction.x, direction.z), scale = Math.min(48, d) / d;
      const x = Math.floor(here.x + direction.x * scale), z = Math.floor(here.z + direction.z * scale);
      if (!getBlock) return idle('Для поиска прохода к крепости нужен getBlock.');
      for (let dy = 4; dy >= -8; dy--) {
        const p = { x, y: Math.floor(here.y) + dy, z };
        if (['minecraft:air', 'minecraft:cave_air'].includes(nameAt(p)) && ['minecraft:air', 'minecraft:cave_air'].includes(nameAt({ ...p, y: p.y + 1 })) && getBlock({ ...p, y: p.y - 1 })?.boundingBox === 'block') return act('goto', { ...p, range: 2 }, 'Двигаться по измеренному направлению и разнести точки бросков.');
      }
      return explore(o, 'ores');
    }
    if (step.type === 'endPortal') {
      if (blocks.some(b => b.name === 'minecraft:end_portal')) return null;
      const frame = blocks.find(b => b.name === 'minecraft:end_portal_frame' && b.properties?.eye === false);
      if (!frame) return idle('Нужна наблюдаемая пустая рамка существующего End-портала.');
      if (!(inv['minecraft:ender_eye'] > 0)) return idle('Закончились глаза Эндера.');
      return act('fillEndFrame', frame.position, 'Заполнить рамку и дождаться подтверждения сервера.');
    }
    if (step.type === 'dragon') {
      if (dragonCombat) return dragonCombat.react(o);
      const decision = dragonDecision(o);
      if (decision.mode === 'completed') return null;
      if (decision.mode === 'evade') return decision.target ? act('evade', { from: decision.target }, decision.reason, 950) : idle(decision.reason);
      if (['crystal', 'dragon'].includes(decision.mode)) {
        if (!inv['minecraft:bow'] || !inv['minecraft:arrow']) return idle('Для боя нужны лук и стрелы.');
        return act('shoot', { entityId: decision.entityId }, decision.reason, 100);
      }
      if (decision.mode === 'perch') return act('wait', { durationMs: 500 }, 'Дракон сидит: сохранить дистанцию и дождаться взлёта.', 100);
      return decision.mode === 'search' ? explore(o) : idle(decision.reason);
    }
  };
  const reactor = { id: 'mckudo:scenario', apiVersion: 1, react(o) {
    activeResource=null;activeNavigation=null;
    for (const [key,portal] of portals) if(portal.dimension===o.dimension && getBlock?.(portal.position) && nameAt(portal.position)!==portal.name) portals.delete(key);
    for (const b of o.world?.sampledBlocks || []) if (['minecraft:nether_portal','minecraft:end_portal'].includes(b.name)) {
      const key=o.dimension+'/'+blockKey(b.position);portals.delete(key);portals.set(key,{dimension:o.dimension,name:b.name,position:{...b.position}});
    }
    while(portals.size>128)portals.delete(portals.keys().next().value);
    while (index < definition.steps.length) {
      const step = definition.steps[index], response = reactStep(step, o);
      if (response) { state = { status: response.action ? 'running' : 'blocked', current: step.id, completed: [...completed], reason: response.reason }; return response; }
      completed.push(step.id); index++;
    }
    state = { status: 'completed', current: null, completed: [...completed], reason: 'Все условия сценария подтверждены наблюдениями.' }; return idle(state.reason);
  } };
  return { reactor, snapshot: () => jsonCopy(state), definition: () => jsonCopy(definition), recordResult(event,action) { activeResource?.recordResult?.(event,action);activeNavigation?.recordResult?.(event,action);if(definition.steps[index]?.type==='dragon')dragonCombat?.recordResult?.(event,action); } };
}
