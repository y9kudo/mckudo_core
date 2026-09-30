import { catalogFromMinecraftData, resourceId } from './catalog.js';
import { createBlockTaxonomy, resourceSources } from './taxonomy.js';
import { planExploration } from './exploration.js';
import { isAir, isFullBlock, isHazard } from './navigation.js';
import { itemValue } from './item-value.js';

const key = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const rid = resourceId;
const count = (o, item) => (o.inventory?.[rid(item)] || 0)+Object.values(o.equipment||{}).filter(i=>i?.item===rid(item)).reduce((n,i)=>n+i.count,0);
const finitePoint = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const pickaxes = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
const basicStages = ['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'iron_pickaxe'];
export const diamondSetTargets = () => Object.fromEntries(['helmet', 'chestplate', 'leggings', 'boots', 'pickaxe', 'sword', 'axe'].map(n => [rid('diamond_' + n), 1]));
export const diamondSetCondition = () => ({ all: Object.entries(diamondSetTargets()).map(([item, n]) => ({any:[{ fact: '/inventory/' + item, gte: n },...['head','chest','legs','feet'].map(slot=>({fact:'/equipment/'+slot+'/item',eq:item}))]})) });

function attachResults(reactor, core) {
  let current = null;
  const start = decision => { current = decision.id === reactor.id ? decision.action : null; };
  const finish = event => { if (event.rule === reactor.id && current) reactor.recordResult(event, current); current = null; };
  core.on('action:start', start); core.on('action:finish', finish);
  return () => { core.off('action:start', start); core.off('action:finish', finish); };
}

/** Opportunistic collection is independent of goals and receives a fresh item position every tick. */
export function createLootReactor({ radius = 24, priority = 80, retryMs = 5000, clock = Date.now, targets = {}, peer } = {}) {
  if (!Number.isFinite(radius) || radius < 1 || radius > 64 || !Number.isInteger(priority) || priority < -1000 || priority > 989 || !Number.isInteger(retryMs) || retryMs < 100) throw new Error('Неверная политика подбора.');
  const blocked = new Map(); let selected = null;
  const reactor = { id: 'mckudo:loot', apiVersion: 1,
    react(o) {
      selected = null;
      if (!o.self?.position || o.self.health === 0 || o.self.freeInventorySlots === 0) return { action: null, reason: 'Подбор сейчас недоступен.' };
      const now = clock(); for (const [id, until] of blocked) if (until <= now) blocked.delete(id);
      const drops = (o.drops || []).filter(d => finitePoint(d.position) && typeof (d.item || d.name) === 'string' && !blocked.has(String(d.id)))
        .map(d => ({ ...d, item: rid(d.item || d.name), distance: distance(d.position, o.self.position) }))
        .filter(d=>{
          if(!peer)return true;
          const claims=peer.snapshot().claims.filter(c=>!c.release&&c.resource.startsWith(`block/${o.dimension}/`)).map(c=>{const [x,y,z]=c.resource.split('/').slice(-3).map(Number);return {...c,d:distance(d.position,{x:x+.5,y:y+.5,z:z+.5})};}).filter(c=>c.d<2).sort((a,b)=>a.d-b.d);
          const owner=claims[0]&&peer.owner(claims[0].resource);return !owner||owner===peer.id;
        })
        .filter(d => d.distance <= radius).sort((a, b) => b.count * itemValue(b.item, { inventory: o.inventory, targets }) / (1 + b.distance) - a.count * itemValue(a.item, { inventory: o.inventory, targets }) / (1 + a.distance));
      const drop = drops[0]; if (!drop) return { action: null, reason: 'Нет доступного наблюдаемого лута.' };
      selected = String(drop.id);
      return { priority, action: { skill: 'collect', args: { item: drop.item, entityId:String(drop.id), beforeCount: count(o, drop.item), origin: drop.position, timeoutMs: 6000 } }, reason: `Подобрать выпавший ${drop.item}.` };
    },
    recordResult(result) { if (selected && result.outcome === 'failure') blocked.set(selected, clock() + retryMs); },
    attach(core) { return attachResults(reactor, core); }
  }; return reactor;
}

/** Stateful, bounded next-action policy. Inventory is always authoritative; plans never complete goals. */
export function createSurvivalReactor({ client, peer, catalog = client?.registry && catalogFromMinecraftData(client.registry), target = 'diamond_set', targets,
  priority = 5, exploration = true, digStaircase = true, maxMemory = 2048, maxRecipeNodes = 2000, clock = Date.now } = {}) {
  if (!catalog || typeof catalog.recipes !== 'function') throw new Error('Выживанию нужен каталог рецептов.');
  if (!['diamond_set', 'iron_pickaxe', 'stone_tools', 'wood'].includes(target) || !Number.isInteger(priority) || priority < -1000 || priority > 989 || !Number.isInteger(maxMemory) || maxMemory < 32 || maxMemory > 8192 || !Number.isInteger(maxRecipeNodes) || maxRecipeNodes < 32 || maxRecipeNodes > 20000) throw new Error('Неверные параметры выживания.');
  const goal = Object.fromEntries(Object.entries(targets ?? (target === 'diamond_set' ? diamondSetTargets() : target === 'iron_pickaxe' ? { iron_pickaxe: 1 } : target === 'stone_tools' ? { stone_pickaxe: 1, furnace: 1 } : { crafting_table: 1 })).map(([item, n]) => [rid(item), n]));
  if (!Object.keys(goal).length || Object.keys(goal).length > 64 || Object.entries(goal).some(([item, n]) => !catalog.item(item) || !Number.isInteger(n) || n < 1 || n > 4096)) throw new Error('Цели: существующие предметы и количество 1–4096.');
  const taxonomy = createBlockTaxonomy(catalog), allSources = resourceSources(catalog, { taxonomy, availableBlocks: catalog.blocks().map(b => b.id) });
  const sourcesByItem = new Map(), recipesByItem = new Map();
  for (const s of allSources) { if (!sourcesByItem.has(s.item)) sourcesByItem.set(s.item, []); sourcesByItem.get(s.item).push(s); }
  // Gravel's ordinary drop is probabilistic; success still requires inventory observation.
  if(catalog.block('minecraft:gravel')&&catalog.item('minecraft:flint'))sourcesByItem.set('minecraft:flint',[{item:'minecraft:flint',block:'minecraft:gravel',tools:[]}]);
  for (const r of catalog.recipes().filter(r => r.executable && r.type.startsWith('minecraft:crafting_'))) { if (!recipesByItem.has(r.output.item)) recipesByItem.set(r.output.item, []); recipesByItem.get(r.output.item).push(r); }
  const memory = new Map(), failures = new Map(), visited = [], milestones = new Set();
  let dimension, pendingStep = null, heading = null, selected = null, o, evaluations, estimates, claim = null;
  const releaseClaim = () => { if(claim){peer?.release(claim);claim=null;} };
  let state = { status: 'waiting', stage: basicStages[0], reason: 'Ожидание наблюдения.', targets: goal, completed: [], knownResources: 0, lastFailure: null };
  const getBlock = p => client?.world?.blockAt(p) ?? null;
  const actionKey = action => action.skill + ':' + JSON.stringify(action.args);
  const blocked = action => (failures.get(actionKey(action))?.until || 0) > clock();
  const response = (skill, args, reason) => ({ priority, action: { skill, args }, reason });
  const station = item => (o.world?.sampledBlocks || []).some(b => b.name === item && distance(b.position, o.self.position) <= 32);
  const hasPickaxe = min => pickaxes.slice(min).some(n => count(o, n));
  const knownSources = item => (sourcesByItem.get(item) || []).flatMap(s => [...memory.values()].filter(b => b.name === s.block).map(b => ({ ...s, ...b })))
    .sort((a, b) => distance(a.position, o.self.position) - distance(b.position, o.self.position));
  const safeDig = p => {
    const b = getBlock(p); if (!b || !b.diggable || isHazard(b) || b.hardness < 0 || /(?:sand|concrete_powder|anvil|dripstone)$/.test(b.name)) return false;
    const here = floor(o.self.position); if (p.x === here.x && p.z === here.z && p.y < here.y) return false;
    return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].every(([x, y, z]) => { const n = getBlock({ x: p.x + x, y: p.y + y, z: p.z + z }); return n && !isHazard(n) && !(y && /(?:sand|gravel|concrete_powder|anvil|dripstone)$/.test(n.name)); });
  };
  const updateMemory = () => {
    if (dimension !== o.dimension) { memory.clear(); visited.length = 0; pendingStep = null; heading = null; dimension = o.dimension; }
    for (const [id, b] of memory) { const actual = getBlock(b.position); if (actual && rid(actual.name) !== b.name) memory.delete(id); }
    const observed = [...(o.world?.sampledBlocks || [])];
    // Stone is common and can be omitted from the adapter's expensive global resource scan.
    if (client?.world) { const p = floor(o.self.position); for (let y = -3; y <= 2; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) { const position = { x: p.x + x, y: p.y + y, z: p.z + z }, b = getBlock(position); if (b && /^(stone|cobblestone|deepslate|cobbled_deepslate|blackstone)$/.test(b.name)) observed.push({ name: rid(b.name), position }); } }
    for (const b of observed) if (finitePoint(b.position) && typeof b.name === 'string') { memory.delete(key(b.position)); memory.set(key(b.position), { name: rid(b.name), position: { ...b.position } }); }
    while (memory.size > maxMemory) memory.delete(memory.keys().next().value);
    const p = floor(o.self.position); if (!visited.some(v => key(v) === key(p))) { visited.push(p); if (visited.length > 512) visited.shift(); }
    for (const stage of basicStages) if (count(o, stage) || ['crafting_table', 'furnace'].includes(stage) && station(rid(stage))) milestones.add(stage);
  };

  const estimate = (item, n = 1, ancestors = []) => {
    const missing = Math.max(0, n - count(o, item)); if (!missing) return 0;
    if (ancestors.includes(item) || ancestors.length > 12 || ++evaluations > maxRecipeNodes) return 1e6;
    const cacheKey = item + ':' + n; if (estimates.has(cacheKey)) return estimates.get(cacheKey);
    const next = [...ancestors, item], sources = knownSources(item);
    let cost = sources.length ? missing * (2 + Math.min(128, distance(sources[0].position, o.self.position)) / 8) : sourcesByItem.has(item) ? 40 + missing * 4 : 1e6;
    if (item === rid('iron_ingot')) cost = Math.min(cost, missing * 4 + estimate(rid('raw_iron'), missing, next));
    for (const recipe of recipesByItem.get(item) || []) {
      const batches = Math.ceil(missing / recipe.output.count);
      const total = 1 + recipe.ingredients.reduce((sum, g) => sum + Math.min(...g.choices.map(choice => estimate(choice, g.count * batches, next))), 0);
      cost = Math.min(cost, total);
    }
    estimates.set(cacheKey, cost); return cost;
  };

  function explore(item, preferred) {
    if (!exploration || !client?.world) return { action: null, reason: `Нет доступного источника ${item}; исследование недоступно.` };
    const ore = /(?:diamond|raw_iron|coal|cobblestone|cobbled_deepslate)$/.test(item), p = floor(o.self.position);
    const destinationY = Math.max((client.world.minY ?? -64)+2,item === rid('diamond') ? -54 : item === rid('raw_iron') ? 16 : p.y - 8);
    if (pendingStep && distance(p, pendingStep) < 0.5) pendingStep = null;
    // A descending staircase removes only adjacent cells, never the supporting block under the bot.
    if (ore && digStaircase && hasPickaxe(0)) {
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      if (!heading) heading = dirs[Math.abs([...String(client.options?.username || '')].reduce((a, c) => a + c.charCodeAt(0), 0)) % 4];
      const ranked = [heading, ...dirs.filter(d => d !== heading)].sort((a, b) => preferred ? distance({ x: p.x + a[0], y: p.y, z: p.z + a[1] }, preferred.position) - distance({ x: p.x + b[0], y: p.y, z: p.z + b[1] }, preferred.position) : 0);
      const candidates = pendingStep ? [pendingStep] : ranked.map(([dx, dz]) => ({ x: p.x + dx, y: p.y > destinationY ? p.y - 1 : p.y, z: p.z + dz }));
      for (const next of candidates) {
        if (!isFullBlock(getBlock({ ...next, y: next.y - 1 })) || visited.some(v => key(v) === key(next))) continue;
        const cells = []; for (let y = Math.max(p.y + 1, next.y + 1); y >= next.y; y--) cells.push({ ...next, y });
        if (cells.some(c => !isAir(getBlock(c)) && !safeDig(c))) continue;
        const cell = cells.find(c => !isAir(getBlock(c)));
        const result = cell ? response('dig', { ...cell, block: rid(getBlock(cell).name) }, `Прокладывать безопасный проход для поиска ${item}.`) : response('navigate', { ...next, range: 0 }, `Исследовать проход к уровню ${destinationY}.`);
        if (blocked(result.action)) continue;
        pendingStep = next; heading = [next.x - p.x, next.z - p.z]; return result;
      }
      pendingStep = null;
    }
    const search = planExploration({ position: p, getBlock, mode: ore ? 'ores' : 'surface', visited, radius: 24, maxNodes: 800, maxCandidates: 8 });
    if (search.status === 'planned') {
      const result = response('navigate', { ...search.target, range: 0 }, search.reason);
      if (!blocked(result.action)) return result;
    }
    return { action: null, reason: `Нет безопасного доступного источника ${item}; неизвестные чанки и опасные проходы не считаются путём.` };
  }

  function ensure(item, amount, ancestors = []) {
    item = rid(item); const missing = Math.max(0, amount - count(o, item)); if (!missing) return null;
    if (ancestors.includes(item) || ancestors.length >= 16) return { action: null, reason: `Циклическая или слишком длинная зависимость ${item}.` };
    const next = [...ancestors, item];
    if (item === rid('iron_ingot')) {
      if (!station(rid('furnace'))) {
        const dependency = ensure('furnace', 1, next); if (dependency) return dependency;
        return response('ensureStation', { station: 'furnace', gather: false }, 'Установить печь для выплавки железа.');
      }
      const raw = ['raw_iron', 'iron_ore', 'deepslate_iron_ore'].find(n => count(o, n)) || 'raw_iron';
      const inputCount = Math.min(missing, 2);
      const dependency = ensure(raw, inputCount, next); if (dependency) return dependency;
      const coal = ['coal', 'charcoal'].find(n => count(o, n));
      let fuel = coal;
      if (!fuel) {
        const planks = taxonomy.members('planks').sort((a, b) => estimate(a, inputCount) - estimate(b, inputCount)); fuel = planks[0];
        if (!fuel) return { action: null, reason: 'Нет доступного рецепта топлива.' };
        const dep = ensure(fuel, inputCount, next); if (dep) return dep;
      }
      return response('smelt', { item, count: inputCount, input: rid(raw), fuel: rid(fuel) }, 'Выплавить железо и проверить результат печи.');
    }
    const sources = knownSources(item);
    if (sourcesByItem.has(item) && !taxonomy.has(item, 'planks')) {
      const minTier = item === rid('obsidian') ? 3 : item === rid('diamond') || item === rid('raw_gold') || item === rid('redstone') ? 2 : item === rid('raw_iron') || item === rid('lapis_lazuli') ? 1 : taxonomy.has(item, 'logs') ? -1 : sources.some(s => s.tools.length) || /(?:coal|cobblestone|cobbled_deepslate)$/.test(item) ? 0 : -1;
      if (minTier >= 0 && !hasPickaxe(minTier)) { const dep = ensure(pickaxes[minTier], 1, next); if (dep) return dep; }
      for (const source of sources) {
        const actual = getBlock(source.position);
        if (client?.world && (!actual || !safeDig(source.position))) continue;
        // Buried resources are remembered, but are approached by excavation, never by teleport or a fictitious path.
        if (actual && ![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => isAir(getBlock({ x: source.position.x + x, y: source.position.y + y, z: source.position.z + z })))) continue;
        const result = response('dig', { ...source.position, block: source.block }, `Добыть ${item} из наблюдаемого ${source.block}.`);
        if (!blocked(result.action)) {
          if(peer){
            const resource=`block/${o.dimension}/${source.position.x}/${source.position.y}/${source.position.z}`;
            const owner=peer.owner(resource);
            if(owner&&owner!==peer.id)continue;
            if(claim!==resource){releaseClaim();claim=resource;peer.claim(resource,{ttlMs:30000});}
            if(!peer.owns(resource))return {action:null,reason:'Согласование ресурса с другими агентами.'};
          }
          return result;
        }
      }
      return explore(item, sources[0]);
    }
    const recipes = (recipesByItem.get(item) || []).map(recipe => {
      const batches = Math.ceil(missing / recipe.output.count);
      const requirements = recipe.ingredients.map(g => ({ item: [...g.choices].sort((a, b) => estimate(a, g.count * batches, next) - estimate(b, g.count * batches, next))[0], count: g.count * batches }));
      return { recipe, requirements, score: requirements.reduce((n, r) => n + estimate(r.item, r.count, next), 0) };
    }).sort((a, b) => a.score - b.score);
    if (!recipes.length) return { action: null, reason: `Нет поддерживаемого способа получить ${item}.` };
    const chosen = recipes[0];
    if (chosen.recipe.station && !station(chosen.recipe.station)) {
      const dependency = ensure(chosen.recipe.station, 1, next); if (dependency) return dependency;
      return response('ensureStation', { station: chosen.recipe.station.replace(/^minecraft:/, ''), gather: false }, 'Установить нужную рабочую станцию.');
    }
    for (const required of chosen.requirements) { const dependency = ensure(required.item, required.count, next); if (dependency) return dependency; }
    return response('craft', { item, count: Math.min(64, missing), recipeId: chosen.recipe.id }, `Создать ${item} из подтверждённых запасов.`);
  }

  const reactor = { id: 'mckudo:survival', apiVersion: 1,
    react(observation) {
      o = observation; selected = null;
      if (!finitePoint(o.self?.position) || o.self.health == null || o.self.health <= 0) return { action: null, reason: 'Выживание ожидает живого бота и позицию.' };
      evaluations = 0; estimates = new Map(); updateMemory();
      const remaining = Object.entries(goal).filter(([item, n]) => count(o, item) < n);
      state = { ...state, targets: { ...goal }, completed: [...milestones], knownResources: memory.size, remaining: Object.fromEntries(remaining) };
      if (!remaining.length) { state = { ...state, status: 'completed', stage: null, reason: 'Весь целевой набор подтверждён текущим инвентарём.' }; return { action: null, reason: state.reason }; }
      const limit = target === 'wood' ? 1 : target === 'stone_tools' ? 4 : 5;
      const stage = basicStages.slice(0, limit).find(s => !milestones.has(s));
      state.stage = stage || remaining[0][0];
      let result = ensure(stage || remaining[0][0], stage ? 1 : remaining[0][1]);
      if (!result) result = { action: null, reason: 'Нужно новое наблюдение для следующего шага.' };
      if (result.action && blocked(result.action)) result = { action: null, reason: 'Пауза перед повтором конкретного неудачного действия.' };
      selected = result.action;
      state = { ...state, status: result.action ? 'progressing' : 'blocked', reason: result.reason };
      return result;
    },
    recordResult(result, action = selected) {
      if(claim&&result.outcome==='success'&&action?.skill==='dig'){peer.claim(claim,{ttlMs:6000});claim=null;}else releaseClaim();
      if (!action || result.outcome === 'cancelled') return;
      const id = actionKey(action);
      if (result.outcome === 'failure') {
        const attempts = (failures.get(id)?.attempts || 0) + 1;
        failures.set(id, { attempts, until: clock() + Math.min(120000, 2000 * 2 ** Math.min(6, attempts - 1)) });
        state.lastFailure = { action, message: String(result.detail || 'Действие не удалось.').slice(0, 300), attempts };
        if (action.skill === 'navigate') { const p = floor(action.args); visited.push(p); if (visited.length > 512) visited.shift(); pendingStep = null; }
        while (failures.size > 256) failures.delete(failures.keys().next().value);
      } else failures.delete(id);
    },
    snapshot: () => structuredClone(state),
    attach(core) { const detach=attachResults(reactor, core); return ()=>{detach();releaseClaim();}; }
  }; return reactor;
}
