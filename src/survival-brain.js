import { catalogFromMinecraftData, resourceId } from './catalog.js';
import { createBlockTaxonomy, resourceSources } from './taxonomy.js';
import { planExploration } from './exploration.js';
import { isAir, isFullBlock, isHazard } from './navigation.js';
import { itemValue } from './item-value.js';
import { smeltingRecipe, fuelItems } from '../packages/kudoconnect/src/crafting.js';

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
  const reactor = { id: 'mckudo:loot', apiVersion: 1, failureScope: 'action',
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
    recordResult(result, action) { const id = action?.args?.entityId ?? selected; if (id && result.outcome === 'failure') blocked.set(String(id), clock() + retryMs); },
    attach(core) { return attachResults(reactor, core); }
  }; return reactor;
}

/** Stateful, bounded next-action policy. Inventory is always authoritative; plans never complete goals. */
export function createSurvivalReactor({ client, peer, spatial, explorationPlanner, catalog = client?.registry && catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}), target = 'diamond_set', targets,
  priority = 5, exploration = true, digStaircase = true, maxMemory = 2048, maxRecipeNodes = 2000, clock = Date.now } = {}) {
  if (!catalog || typeof catalog.recipes !== 'function') throw new Error('Выживанию нужен каталог рецептов.');
  if (!['diamond_set', 'iron_pickaxe', 'stone_tools', 'wood'].includes(target) || !Number.isInteger(priority) || priority < -1000 || priority > 989 || !Number.isInteger(maxMemory) || maxMemory < 32 || maxMemory > 8192 || !Number.isInteger(maxRecipeNodes) || maxRecipeNodes < 32 || maxRecipeNodes > 20000) throw new Error('Неверные параметры выживания.');
  const taxonomy = createBlockTaxonomy(catalog);
  const requested = Object.fromEntries(Object.entries(targets ?? (target === 'diamond_set' ? diamondSetTargets() : target === 'iron_pickaxe' ? { iron_pickaxe: 1 } : target === 'stone_tools' ? { stone_pickaxe: 1, furnace: 1 } : { crafting_table: 1 })).map(([item, n]) => [item.startsWith('#')?item:rid(item), n]));
  if (!Object.keys(requested).length || Object.keys(requested).length > 64 || Object.entries(requested).some(([item, n]) => !(item.startsWith('#')?taxonomy.members(item.slice(1)).some(id=>catalog.item(id)):catalog.item(item)) || !Number.isInteger(n) || n < 1 || n > 4096)) throw new Error('Цели: существующие предметы/#классы и количество 1–4096.');
  const classes=Object.entries(requested).filter(([id])=>id.startsWith('#')),explicit=Object.fromEntries(Object.entries(requested).filter(([id])=>!id.startsWith('#')));
  let goal={...explicit};
  const allSources = resourceSources(catalog, { taxonomy, availableBlocks: catalog.blocks().map(b => b.id) });
  const sourcesByItem = new Map();
  const recipesFor=item=>catalog.recipesFor(item).filter(r=>r.executable&&r.type.startsWith('minecraft:crafting_'));
  const furnaceRecipe = item => client?.registry ? smeltingRecipe(client.registry,item) : item === rid('iron_ingot') ? { inputs:['raw_iron','iron_ore','deepslate_iron_ore'] } : null;
  const mobSources={string:['spider','cave_spider'],feather:['chicken'],beef:['cow'],porkchop:['pig'],mutton:['sheep'],chicken:['chicken'],leather:['cow'],bone:['skeleton'],ender_pearl:['enderman'],blaze_rod:['blaze']};
  for (const s of allSources) { if (!sourcesByItem.has(s.item)) sourcesByItem.set(s.item, []); sourcesByItem.get(s.item).push(s); }
  // Gravel's ordinary drop is probabilistic; success still requires inventory observation.
  if(catalog.block('minecraft:gravel')&&catalog.item('minecraft:flint'))sourcesByItem.set('minecraft:flint',[{item:'minecraft:flint',block:'minecraft:gravel',tools:[]}]);
  const memory = new Map(), failures = new Map(), unreachable = new Map(), visited = [], milestones = new Set();
  let dimension, pendingStep = null, heading = null, selected = null, o, evaluations, estimates, claim = null, trace = [];
  const releaseClaim = () => { if(claim){peer?.release(claim);claim=null;} };
  let state = { status: 'waiting', stage: basicStages[0], reason: 'Ожидание наблюдения.', targets: goal, completed: [], knownResources: 0, lastFailure: null };
  const getBlock = p => client?.world?.blockAt(p) ?? null;
  const actionKey = action => action.skill + ':' + JSON.stringify(action.args);
  const blocked = action => (failures.get(actionKey(action))?.until || 0) > clock();
  const learnedCosts=new Map();
  const learnedCost = action => {if(!client?.planningPolicy)return 0;const id=actionKey(action);if(!learnedCosts.has(id))learnedCosts.set(id,client.planningPolicy.assess(o,action).cost);return learnedCosts.get(id);};
  const response = (skill, args, reason) => ({ priority, action: { skill, args }, reason });
  const station = item => (o.world?.sampledBlocks || []).some(b => b.name === item && distance(b.position, o.self.position) <= 32);
  const hasPickaxe = min => pickaxes.slice(min).some(n => count(o, n));
  const sourceCache = new Map(), observedByBlock = new Map();
  const knownSources = item => {
    if (!sourceCache.has(item)) sourceCache.set(item, (sourcesByItem.get(item) || []).flatMap(s => (observedByBlock.get(s.block) || []).map(b => ({ ...s, ...b }))).filter(s=>!client?.protection || client.protection.check({operation:'dig',dimension:o.dimension,position:s.position,block:getBlock(s.position),getBlock}).allowed)
      .sort((a, b) => distance(a.position, o.self.position) + learnedCost({skill:'dig',args:{...a.position,block:a.block}}) - distance(b.position, o.self.position) - learnedCost({skill:'dig',args:{...b.position,block:b.block}})));
    return sourceCache.get(item);
  };
  const safeDig = p => {
    const b = getBlock(p); if (!b || !b.diggable || isHazard(b) || b.hardness < 0 || /(?:sand|concrete_powder|anvil|dripstone)$/.test(b.name)) return false;
    if (client?.protection && !client.protection.check({operation:'dig',dimension:o.dimension,position:p,block:b,getBlock}).allowed) return false;
    const here = floor(o.self.position); if (p.x === here.x && p.z === here.z && p.y < here.y) return false;
    return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].every(([x, y, z]) => { const n = getBlock({ x: p.x + x, y: p.y + y, z: p.z + z }); return n && !isHazard(n) && !(y && /(?:sand|gravel|concrete_powder|anvil|dripstone)$/.test(n.name)); });
  };
  const updateMemory = () => {
    if (dimension !== o.dimension) { memory.clear(); unreachable.clear(); visited.length = 0; pendingStep = null; heading = null; dimension = o.dimension; }
    if (spatial) for (const b of spatial.entries({ dimension, near: floor(o.self.position) }).slice(0, maxMemory)) {
      if (!memory.has(key(b.position))) memory.set(key(b.position), { name: b.name, position: { ...b.position } });
    }
    for (const [id, failure] of unreachable) if (distance(failure.from, o.self.position) >= 3 || getBlock(failure.position)?.name !== failure.block) unreachable.delete(id);
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
    let cost = sources.length ? missing * (2 + Math.min(128, distance(sources[0].position, o.self.position)) / 8 + learnedCost({skill:'dig',args:{...sources[0].position,block:sources[0].block}})) : sourcesByItem.has(item) ? 40 + missing * 4 : 1e6;
    if(mobSources[item.replace(/^minecraft:/,'')])cost=Math.min(cost,50+missing*10);
    const smelting=furnaceRecipe(item);
    if(smelting)cost=Math.min(cost,missing*4+Math.min(...smelting.inputs.filter(n=>catalog.item(rid(n))).map(n=>estimate(rid(n),missing,next))));
    for (const recipe of recipesFor(item)) {
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
      const candidates = pendingStep ? [pendingStep] : [
        ...ranked.map(([dx, dz]) => ({ x: p.x + dx, y: p.y > destinationY ? p.y - 1 : p.y, z: p.z + dz })),
        ...(p.y>destinationY?ranked.map(([dx,dz])=>({x:p.x+dx,y:p.y,z:p.z+dz})):[])
      ];
      for (const next of candidates) {
        if (!isFullBlock(getBlock({ ...next, y: next.y - 1 })) || visited.some(v => key(v) === key(next))) continue;
        const cells = []; for (let y = Math.max(p.y + 1, next.y + 1); y >= next.y; y--) cells.push({ ...next, y });
        if (cells.some(c => !isAir(getBlock(c)) && !safeDig(c))) continue;
        const cell = cells.find(c => !isAir(getBlock(c)));
        const result = cell ? response('dig', { ...cell, block: rid(getBlock(cell).name) }, `Прокладывать безопасный проход для поиска ${item}.`) : response('navigate', { ...next, range: 0 }, `Исследовать проход к уровню ${destinationY}.`);
        // Finish opening and entering the step before collecting dirt above it.
        // Otherwise loot navigation stands on the unfinished support and makes
        // the final excavation an illegal "dig under yourself" operation.
        result.priority=Math.max(priority,81);
        if (blocked(result.action)) continue;
        pendingStep = next; heading = [next.x - p.x, next.z - p.z]; return result;
      }
      pendingStep = null;
      // A flooded/unknown dead end is a reason to backtrack, not to stand forever
      // at the bottom. The native executor can clear safe headroom on this known
      // staircase; it still refuses liquids, unknown cells and valuable blocks.
      const observedExits=[];
      for(let y=p.y+1;y<=p.y+4;y++)for(let x=p.x-4;x<=p.x+4;x++)for(let z=p.z-4;z<=p.z+4;z++){
        const v={x,y,z};if(isAir(getBlock(v))&&isAir(getBlock({...v,y:y+1}))&&isFullBlock(getBlock({...v,y:y-1})))observedExits.push(v);
      }
      observedExits.sort((a,b)=>distance(a,p)-distance(b,p));
      const exits=[...visited.filter(v=>v.y===p.y+1&&Math.hypot(v.x-p.x,v.z-p.z)<=1.5).reverse(),...observedExits]
        .filter(v=>isFullBlock(getBlock({...v,y:v.y-1})));
      for(const exit of exits){
        const result=response('navigate',{...exit,range:0,bridge:false,excavate:true,maxDrop:2},'Вернуться на известную ступень из тупика и выбрать другой проход.');
        result.priority=Math.max(priority,81);if(!blocked(result.action))return result;
      }
    }
    const searchOptions = { position: p, getBlock, mode: ore ? 'ores' : 'surface', visited, radius: 24, maxNodes: 800, maxCandidates: 8, candidateCost: target => learnedCost({skill:'navigate',args:{...target,range:0}}) + (preferred ? Math.max(0, 24 + distance(target, preferred.position) - distance(p, preferred.position)) / 3 : 0) };
    const search = explorationPlanner ? explorationPlanner.poll({ ...searchOptions, context: item + ':' + (preferred ? key(preferred.position) : '') }) : planExploration(searchOptions);
    if (search.status === 'pending') return { action: null, reason: search.reason };
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
    if(trace.length<32)trace.push({item,required:amount,missing,parent:ancestors.at(-1)||null});
    const mobs=mobSources[item.replace(/^minecraft:/,'')];
    if(mobs){
      const drop=o.drops?.find(d=>d.item===item);
      if(drop)return response('collect',{item,entityId:drop.id,origin:drop.position,timeoutMs:6000},`Подобрать наблюдаемый ${item}.`);
      const mob=(o.entities||[]).filter(e=>mobs.includes(e.name)&&e.kind!=='player'&&!e.isBaby&&!e.named&&distance(e.position,o.self.position)<=32).sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position))[0];
      if(mob){
        const next=distance(mob.position,o.self.position)>2.8?response('navigate',{...floor(mob.position),range:1,bridge:false,sprintJump:false},`Подойти к источнику ${item}.`):response('combat',{entityId:mob.id,maxDistance:5,durationMs:600},`Добыть ${item} с наблюдаемого ${mob.name}.`);
        if(!blocked(next.action))return next;
      }
      return explore(item);
    }
    const smelting=furnaceRecipe(item);
    if (smelting) {
      const inputs=smelting.inputs.filter(n=>catalog.item(rid(n))).sort((a,b)=>estimate(rid(a),1,next)-estimate(rid(b),1,next));
      const raw = inputs.find(n => count(o, n)) || inputs[0];
      if(!raw)return {action:null,reason:`Нет входного ресурса для выплавки ${item}.`};
      const inputCount = Math.min(missing, 2);
      const dependency = ensure(raw, inputCount, next); if (dependency) return dependency;
      const coal = ['coal', 'charcoal'].find(n => count(o, n) >= Math.ceil(inputCount/fuelItems(n)));
      let fuel = coal;
      if (!fuel) {
        const planks = taxonomy.members('planks').filter(n=>fuelItems(n.replace(/^minecraft:/,''))>0).sort((a, b) => estimate(a, inputCount) - estimate(b, inputCount)); fuel = planks[0];
        if (!fuel) return { action: null, reason: 'Нет доступного рецепта топлива.' };
        const dep = ensure(fuel, inputCount, next); if (dep) return dep;
      }
      if (!station(rid('furnace'))) {
        const dependency = ensure('furnace', 1, next); if (dependency) return dependency;
        return response('ensureStation', { station: 'furnace', gather: false }, `Установить печь для выплавки ${item}.`);
      }
      return response('smelt', { item, count: inputCount, input: rid(raw), fuel: rid(fuel) }, `Выплавить ${item} и проверить результат печи.`);
    }
    const sources = knownSources(item);
    if (sourcesByItem.has(item) && !taxonomy.has(item, 'planks')) {
      const minTier = item === rid('obsidian') ? 3 : item === rid('diamond') || item === rid('raw_gold') || item === rid('redstone') ? 2 : item === rid('raw_iron') || item === rid('lapis_lazuli') ? 1 : taxonomy.has(item, 'logs') ? -1 : sources.some(s => s.tools.length) || /(?:coal|cobblestone|cobbled_deepslate)$/.test(item) ? 0 : -1;
      if (minTier >= 0 && !hasPickaxe(minTier)) { const dep = ensure(pickaxes[minTier], 1, next); if (dep) return dep; }
      // Prefer extending a local mine over chasing an exposed cave face many
      // levels below the surface, for which ordinary walking cannot find a path.
      if(exploration&&digStaircase&&client?.world&&minTier>=0&&sources.length&&sources.every(s=>s.position.y<o.self.position.y-4))return explore(item,sources[0]);
      for (const source of sources) {
        if (unreachable.has(key(source.position))) continue;
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
            if(claim!==resource){releaseClaim();claim=resource;peer.claim(resource,{bid:distance(source.position,o.self.position)/8+learnedCost(result.action),ttlMs:30000});}
            if(!peer.owns(resource))return {action:null,reason:'Согласование ресурса с другими агентами.'};
          }
          return result;
        }
      }
      return explore(item, sources[0]);
    }
    const recipes = recipesFor(item).map(recipe => {
      const batches = Math.ceil(missing / recipe.output.count);
      const chosenIngredients=new Map();
      for(const g of recipe.ingredients){const item=[...g.choices].sort((a,b)=>estimate(a,g.count*batches+(chosenIngredients.get(a)||0),next)-estimate(b,g.count*batches+(chosenIngredients.get(b)||0),next))[0];chosenIngredients.set(item,(chosenIngredients.get(item)||0)+g.count*batches);}
      const requirements=[...chosenIngredients].map(([item,count])=>({item,count}));
      const action={skill:'craft',args:{item,count:Math.min(64,missing),recipeId:recipe.id}};
      return { recipe, requirements, score: requirements.reduce((n, r) => n + estimate(r.item, r.count, next), 0) + learnedCost(action) + (blocked(action)?1e5:0) };
    }).sort((a, b) => a.score - b.score);
    if (!recipes.length) return { action: null, reason: `Нет поддерживаемого способа получить ${item}.` };
    const chosen = recipes[0];
    const entry=trace.findLast(t=>t.item===item);if(entry){entry.recipeId=chosen.recipe.id;entry.ingredients=chosen.requirements;entry.alternatives=recipes.slice(0,4).map(r=>({recipeId:r.recipe.id,cost:r.score}));}
    // Collect a batch before returning to the workstation. Walking back after
    // every mined block prevented an excavation from ever advancing.
    for (const required of chosen.requirements) { const dependency = ensure(required.item, required.count, next); if (dependency) return dependency; }
    if (chosen.recipe.station && !station(chosen.recipe.station)) {
      const dependency = ensure(chosen.recipe.station, 1, next); if (dependency) return dependency;
      return response('ensureStation', { station: chosen.recipe.station.replace(/^minecraft:/, ''), gather: false }, 'Установить нужную рабочую станцию.');
    }
    return response('craft', { item, count: Math.min(64, missing), recipeId: chosen.recipe.id }, `Создать ${item} из подтверждённых запасов.`);
  }

  const reactor = { id: 'mckudo:survival', apiVersion: 1, failureScope: 'action',
    react(observation) {
      o = observation; selected = null;
      if (!finitePoint(o.self?.position) || o.self.health == null || o.self.health <= 0) return { action: null, reason: 'Выживание ожидает живого бота и позицию.' };
      evaluations = 0; estimates = new Map(); trace = []; learnedCosts.clear(); updateMemory();
      sourceCache.clear(); observedByBlock.clear();
      for (const block of memory.values()) {
        if (!observedByBlock.has(block.name)) observedByBlock.set(block.name, []);
        observedByBlock.get(block.name).push(block);
      }
      goal={...explicit};
      for(const [selector,n]of classes){
        const members=taxonomy.members(selector.slice(1)).filter(id=>catalog.item(id)),owned=members.reduce((sum,id)=>sum+count(o,id),0);if(owned>=n)continue;
        const nearby=members.flatMap(item=>knownSources(item).map(source=>({item,distance:distance(source.position,o.self.position)+learnedCost({skill:'dig',args:{...source.position,block:source.block}})}))).sort((a,b)=>a.distance-b.distance);
        const item=nearby[0]?.item||members.sort((a,b)=>count(o,b)-count(o,a))[0];goal[item]=Math.max(goal[item]||0,count(o,item)+n-owned);
      }
      const remaining = Object.entries(goal).filter(([item, n]) => count(o, item) < n);
      state = { ...state, targets: { ...goal }, completed: [...milestones], knownResources: memory.size, remaining: Object.fromEntries(remaining) };
      if (!remaining.length) { state = { ...state, status: 'completed', stage: null, reason: 'Весь целевой набор подтверждён текущим инвентарём.' }; return { action: null, reason: state.reason }; }
      const limit = targets?0:target === 'wood' ? 1 : target === 'stone_tools' ? 4 : 5;
      const stage = basicStages.slice(0, limit).find(s => !milestones.has(s));
      state.stage = stage || remaining[0][0];
      let result = ensure(stage || remaining[0][0], stage ? 1 : remaining[0][1]);
      if (!result) result = { action: null, reason: 'Нужно новое наблюдение для следующего шага.' };
      if (result.action && blocked(result.action)) result = { action: null, reason: 'Пауза перед повтором конкретного неудачного действия.' };
      selected = result.action;
      state = { ...state, status: result.action ? 'progressing' : 'blocked', reason: result.reason, plan: trace };
      return result;
    },
    recordResult(result, action = selected) {
      if(claim&&result.outcome==='success'&&action?.skill==='dig'){peer.claim(claim,{ttlMs:6000});claim=null;}else releaseClaim();
      if (!action || result.outcome === 'cancelled') return;
      if (action.skill === 'navigate') explorationPlanner?.invalidate();
      const id = actionKey(action);
      if (result.outcome === 'failure') {
        // A timer does not make an unreachable block reachable. Reconsider it after
        // movement or a block change; meanwhile excavate a new approach or explore.
        if (action.skill === 'dig' && /достижимой|маршрут|пути/i.test(result.detail || '') && finitePoint(action.args) && o?.self?.position) {
          unreachable.set(key(action.args), {position: floor(action.args), from: {...o.self.position}, block: getBlock(action.args)?.name});
          while (unreachable.size > 256) unreachable.delete(unreachable.keys().next().value);
        }
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
