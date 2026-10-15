import { catalogFromMinecraftData, resourceId } from './catalog.js';
import { createBlockTaxonomy, resourceSources } from './taxonomy.js';
import { planExploration } from './exploration.js';
import { isAir, isFullBlock, isHazard } from './navigation.js';
import { itemValue } from './item-value.js';
import {traceVisibility} from '../packages/omconnect/src/visibility.js';
import { smeltingRecipe, fuelItems } from '../packages/omconnect/src/crafting.js';
import { blockEvidenceValue } from '../packages/omconnect/src/failures.js';
import {piglinAngerRisk} from '../packages/omconnect/src/bartering.js';
import {remainingDurability} from '../packages/omconnect/src/equipment.js';
import {bridgeMaterials} from '../packages/omconnect/src/movement.js';
import {planResourcePillar,constructionSoil} from './elevated-access.js';

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
export function createLootReactor({ radius = 24, priority = 80, retryMs = 5000, clock = Date.now, targets = {}, stockLimits = {}, peer } = {}) {
  if (!Number.isFinite(radius) || radius < 1 || radius > 64 || !Number.isInteger(priority) || priority < -1000 || priority > 989 || !Number.isInteger(retryMs) || retryMs < 100 || !stockLimits || typeof stockLimits!=='object' || Array.isArray(stockLimits) || Object.entries(stockLimits).some(([id,n])=>!/^minecraft:[a-z0-9_]+$/.test(id)||!Number.isInteger(n)||n<0||n>4096)) throw new Error("Wrong selection policy.");
  const blocked = new Map(); let selected = null, observation,failedStreak=0,yieldUntil=0;
  const reactor = { id: 'overmind:loot', apiVersion: 1, failureScope: 'action',
    react(o) {
      observation=o;
      selected = null;
      if (!o.self?.position || o.self.health === 0 || o.self.freeInventorySlots === 0) return { action: null, reason: "Selection is not available now." };
      const now = clock(),present=new Map((o.drops||[]).map(d=>[String(d.id),d]));
      for(const [id,failure] of blocked){
        const drop=present.get(id);
        if(failure.dimension!==o.dimension||distance(failure.from,o.self.position)>=3||now>failure.until+120000||drop&&(!finitePoint(drop.position)||distance(failure.origin,drop.position)>=1)){blocked.delete(id);yieldUntil=0;}
      }
      if(now<yieldUntil)return {action:null,reason:"Unaccessible lute postponed: Continue with the core task."};
      const drops = (o.drops || []).filter(d => finitePoint(d.position) && typeof (d.item || d.name) === 'string' && (blocked.get(String(d.id))?.until||0)<=now)
        .map(d => ({ ...d, item: rid(d.item || d.name), distance: distance(d.position, o.self.position) }))
        .filter(d=>{
          if(!peer)return true;
          const claims=peer.snapshot().claims.filter(c=>!c.release&&c.resource.startsWith(`block/${o.dimension}/`)).map(c=>{const [x,y,z]=c.resource.split('/').slice(-3).map(Number);return {...c,d:distance(d.position,{x:x+.5,y:y+.5,z:z+.5})};}).filter(c=>c.d<2).sort((a,b)=>a.d-b.d);
          const owner=claims[0]&&peer.owner(claims[0].resource);return !owner||owner===peer.id;
        })
        .filter(d => d.distance <= radius && (o.inventory[d.item]||0)<(stockLimits[d.item]??Infinity)).sort((a, b) => b.count * itemValue(b.item, { inventory: o.inventory, targets }) / (1 + b.distance) - a.count * itemValue(a.item, { inventory: o.inventory, targets }) / (1 + a.distance));
      const drop = drops[0]; if (!drop) return { action: null, reason: "No visible lute." };
      selected = String(drop.id);
      return { priority, action: { skill: 'collect', args: { item: drop.item, entityId:String(drop.id), beforeCount: count(o, drop.item), origin: drop.position, timeoutMs: 6000 } }, reason: `Select the fallen one ${drop.item}.` };
    },
    recordResult(result, action) {
      const id=String(action?.args?.entityId??selected??'');if(!id)return;
      if(result.outcome==='success'){blocked.delete(id);failedStreak=0;yieldUntil=0;return;}
      const origin=action?.args?.origin||observation?.drops?.find(d=>String(d.id)===id)?.position;
      if(result.outcome==='failure'&&finitePoint(origin)&&finitePoint(observation?.self?.position)){
        failedStreak++;if(failedStreak>=2)yieldUntil=clock()+Math.min(30000,retryMs*2**Math.min(3,failedStreak-1));
        const attempts=(blocked.get(id)?.attempts||0)+1;
        blocked.set(id,{attempts,until:clock()+Math.min(120000,retryMs*2**Math.min(8,attempts-1)),origin:{...origin},from:{...observation.self.position},dimension:observation.dimension});
        while(blocked.size>256)blocked.delete(blocked.keys().next().value);
      }
    },
    attach(core) { return attachResults(reactor, core); }
  }; return reactor;
}

/** Stateful, bounded next-action policy. Inventory is always authoritative; plans never complete goals. */
export function createSurvivalReactor({ client, peer, spatial, explorationPlanner, actionEvidence, catalog = client?.registry && catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}), target = 'diamond_set', targets,
  priority = 5, exploration = true, digStaircase = true, preservePickaxeTier = 2, maxMemory = 2048, maxRecipeNodes = 2000, clock = Date.now } = {}) {
  if (!catalog || typeof catalog.recipes !== 'function') throw new Error("Survival needs a recipe catalogue.");
  if(actionEvidence && (typeof actionEvidence.record!=='function'||typeof actionEvidence.assess!=='function'))throw new Error("actionEvidence: memory with record/assess.");
  if(preservePickaxeTier!==false&&(!Number.isInteger(preservePickaxeTier)||preservePickaxeTier<1||preservePickaxeTier>4))throw new Error("preservePickaxeTier: false or 1–4.");
  if (!['diamond_set', 'iron_pickaxe', 'stone_tools', 'wood'].includes(target) || !Number.isInteger(priority) || priority < -1000 || priority > 989 || !Number.isInteger(maxMemory) || maxMemory < 32 || maxMemory > 8192 || !Number.isInteger(maxRecipeNodes) || maxRecipeNodes < 32 || maxRecipeNodes > 20000) throw new Error("Uncorrect Survival Parameters.");
  const taxonomy = createBlockTaxonomy(catalog);
  let cavePlanner=null;
  // Match the executor's usable-tool rule, not just the existence of a worn stack.
  // A fresh tool is crafted even if the inventory still contains its unusable predecessor.
  const countCache=new Map(),recipeCache=new Map(),blockCache=new Map();
  const count=(o,item)=>{
    const id=rid(item);
    if(countCache.has(id))return countCache.get(id);
    const total=(o.inventory?.[id]||0)+Object.values(o.equipment||{}).filter(i=>i?.item===id).reduce((n,i)=>n+i.count,0);
    const usable=client?.inventory?.items&&client.registry&&/_(pickaxe|axe|shovel|hoe|sword)$/.test(id)?Math.max(0,total-client.inventory.items().filter(i=>rid(i.name)===id&&remainingDurability(i,client.registry)<=1).reduce((n,i)=>n+i.count,0)):total;
    countCache.set(id,usable);return usable;
  };
  const requested = Object.fromEntries(Object.entries(targets ?? (target === 'diamond_set' ? diamondSetTargets() : target === 'iron_pickaxe' ? { iron_pickaxe: 1 } : target === 'stone_tools' ? { stone_pickaxe: 1, furnace: 1 } : { crafting_table: 1 })).map(([item, n]) => [item.startsWith('#')?item:rid(item), n]));
  if (!Object.keys(requested).length || Object.keys(requested).length > 64 || Object.entries(requested).some(([item, n]) => !(item.startsWith('#')?taxonomy.members(item.slice(1)).some(id=>catalog.item(id)):catalog.item(item)) || !Number.isInteger(n) || n < 1 || n > 4096)) throw new Error("Objectives: existing items/#classes and number 1–4096.");
  const classes=Object.entries(requested).filter(([id])=>id.startsWith('#')),explicit=Object.fromEntries(Object.entries(requested).filter(([id])=>!id.startsWith('#')));
  let goal={...explicit};
  const allSources = resourceSources(catalog, { taxonomy, availableBlocks: catalog.blocks().map(b => b.id) });
  const sourcesByItem = new Map();
  const recipesFor=item=>{if(!recipeCache.has(item))recipeCache.set(item,catalog.recipesFor(item).filter(r=>r.executable&&r.type.startsWith('minecraft:crafting_')));return recipeCache.get(item);};
  const furnaceRecipe = item => client?.registry ? smeltingRecipe(client.registry,item) : item === rid('iron_ingot') ? { inputs:['raw_iron','iron_ore','deepslate_iron_ore'] } : null;
  const mobSources={string:['spider','cave_spider'],feather:['chicken'],beef:['cow'],porkchop:['pig'],mutton:['sheep'],chicken:['chicken'],leather:['cow'],bone:['skeleton'],ender_pearl:['enderman'],blaze_rod:['blaze']};
  for (const s of allSources) { if (!sourcesByItem.has(s.item)) sourcesByItem.set(s.item, []); sourcesByItem.get(s.item).push(s); }
  // Gravel's ordinary drop is probabilistic; success still requires inventory observation.
  if(catalog.block('minecraft:gravel')&&catalog.item('minecraft:flint'))sourcesByItem.set('minecraft:flint',[{item:'minecraft:flint',block:'minecraft:gravel',tools:[]}]);
  const memory = new Map(), failures = new Map(), unreachable = new Map(), unreachableRoutes = new Map(), visited = [], milestones = new Set();
  let dimension, pendingStep = null, heading = null, selected = null, o, evaluations, estimates, claim = null, trace = [], elevation=null;
  const releaseClaim = () => { if(claim){peer?.release(claim);claim=null;} };
  let state = { status: 'waiting', stage: basicStages[0], reason: "Waiting for observation.", targets: goal, completed: [], knownResources: 0, lastFailure: null };
  const getBlock = p => {const id=key(p);if(!blockCache.has(id))blockCache.set(id,client?.world?.blockAt(p)??null);return blockCache.get(id);};
  const actionKey = action => action.skill + ':' + JSON.stringify(action.args);
  const routeStamp=(from,to)=>[from,to].flatMap(p=>{
    const cells=[];for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=2;dy++){
      const b=getBlock({x:p.x+dx,y:p.y+dy,z:p.z+dz});cells.push(b?.stateId??b?.name??null);
    }return cells;
  }).join('|');
  const evidenceChecks = new Map();
  const evidenceAgent = client?.options?.username || 'local';
  const readFact = (fact, action) => {
    const position=client?.state?.position || o.self.position;
    if(fact==='position')return key(position);
    if(fact==='navigationMode')return client?.state?.gameMode==='creative'&&client.state.allowFlying&&action.args?.creativeFlight!==false&&action.args?.excavate!==true&&Math.hypot(action.args?.x-position.x,action.args?.z-position.z)>3?'creative-flight':'ground';
    return fact.startsWith('block:') ? blockEvidenceValue(getBlock(Object.fromEntries(fact.slice(6).split(',').map((n,i)=>[['x','y','z'][i],Number(n)])))) : null;
  };
  const blocked = action => {
    const id=actionKey(action);
    if(actionEvidence && !evidenceChecks.has(id)){
      const assessment=actionEvidence.assess({agentId:evidenceAgent,dimension:o.dimension,action,readFact:fact=>readFact(fact,action)});
      evidenceChecks.set(id,assessment);
      if(!assessment.blocked&&assessment.changedFacts?.length)failures.delete(id);
    }
    return evidenceChecks.get(id)?.blocked || unreachableRoutes.has(id) || (failures.get(id)?.until || 0) > clock();
  };
  const learnedCosts=new Map();
  const learnedCost = action => {if(!client?.planningPolicy)return 0;const id=actionKey(action);if(!learnedCosts.has(id))learnedCosts.set(id,client.planningPolicy.assess(o,action).cost);return learnedCosts.get(id);};
  const response = (skill, args, reason) => ({ priority, action: { skill, args:preservePickaxeTier!==false&&['dig','navigate'].includes(skill)?{...args,preservePickaxeTier}:args }, reason });
  // A station in a different vertical part of a cave is an observation, not
  // proof that a craft can use it. Finish the approach or prepare a local one.
  const station = item => (o.world?.sampledBlocks || []).some(b => b.name === item && distance(b.position, o.self.position) <= 32 && Math.abs(b.position.y-o.self.position.y)<=4);
  const hasPickaxe = min => pickaxes.slice(min).some(n => count(o, n));
  const sourceCache = new Map(), observedByBlock = new Map();
  const sourceDistance=p=>distance(p,o.self.position)+Math.max(0,p.y-o.self.position.y-3)*4;
  const knownSources = item => {
    if (!sourceCache.has(item)) sourceCache.set(item, (sourcesByItem.get(item) || []).flatMap(s => (observedByBlock.get(s.block) || []).map(b => ({ ...s, ...b }))).filter(s=>!client?.protection || client.protection.check({operation:'dig',dimension:o.dimension,position:s.position,block:getBlock(s.position),getBlock}).allowed)
      .sort((a, b) => sourceDistance(a.position) + learnedCost({skill:'dig',args:{...a.position,block:a.block}}) - sourceDistance(b.position) - learnedCost({skill:'dig',args:{...b.position,block:b.block}})));
    return sourceCache.get(item);
  };
  const safeDig = p => {
    const b = getBlock(p); if (!b || !b.diggable || isHazard(b) || b.hardness < 0 || /^(?:sand|red_sand|.*_concrete_powder|(?:chipped_|damaged_)?anvil|pointed_dripstone)$/.test(b.name)) return false;
    if(/^(?:nether_gold_ore|gold_block|gilded_blackstone)$/.test(b.name)&&piglinAngerRisk(o.dimension,p,o.entities||[]))return false;
    if (client?.protection && !client.protection.check({operation:'dig',dimension:o.dimension,position:p,block:b,getBlock}).allowed) return false;
    const here = floor(o.self.position); if (p.x === here.x && p.z === here.z && p.y < here.y) return false;
    return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].every(([x, y, z]) => { const n = getBlock({ x: p.x + x, y: p.y + y, z: p.z + z }); return n && !isHazard(n) && !(y && /^(?:sand|red_sand|gravel|.*_concrete_powder|(?:chipped_|damaged_)?anvil|pointed_dripstone)$/.test(n.name)); });
  };
  const updateMemory = () => {
    if (dimension !== o.dimension) { memory.clear(); unreachable.clear(); unreachableRoutes.clear(); visited.length = 0; pendingStep = null; heading = null; elevation=null; dimension = o.dimension; }
    for(const [id,failure]of unreachableRoutes)if(key(o.self.position)!==key(failure.from)||routeStamp(failure.from,failure.to)!==failure.stamp){unreachableRoutes.delete(id);failures.delete(id);}
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
    let cost = sources.length ? missing * (2 + Math.min(256, sourceDistance(sources[0].position)) / 8 + learnedCost({skill:'dig',args:{...sources[0].position,block:sources[0].block}})) : sourcesByItem.has(item) ? 40 + missing * 4 : 1e6;
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
    if (!exploration || !client?.world) return { action: null, reason: `No available source ${item}; Unavailable.` };
    const ore = /(?:diamond|raw_iron|raw_gold|redstone|lapis_lazuli|gold_nugget|quartz|ancient_debris|coal|cobblestone|cobbled_deepslate)$/.test(item), p = floor(o.self.position);
    const levels=o.dimension==='minecraft:the_nether'?{ancient_debris:15,gold_nugget:32,quartz:32}:{diamond:-54,raw_iron:16,raw_gold:-16,redstone:-54,lapis_lazuli:0};
    const destinationY = Math.max((client.world.minY ?? -64)+2,levels[item.replace(/^minecraft:/,'')]??p.y-8);
    if (pendingStep && distance(p, pendingStep) < 0.5) pendingStep = null;
    // Before opening a shaft, test a known, walkable descent into a cave.
    // This is based on observed blocks and a complete route, never on an assumed void.
    if (ore && !pendingStep && p.y > destinationY + 3) {
      cavePlanner??=explorationPlanner?.fork?.()??false;
      const buildingStone=/^minecraft:(?:cobblestone|cobbled_deepslate)$/.test(item);
      const caveOptions={position:p,getBlock,mode:'ores',visited,radius:buildingStone?8:32,maxNodes:1800,maxCandidates:buildingStone?8:24,maxDrop:1,context:'cave-before-shaft'};
      const cave=cavePlanner?cavePlanner.poll(caveOptions):planExploration(caveOptions);
      if(cave.status==='pending')return {action:null,reason:cave.reason};
      if(cave.status==='planned' && cave.target.y <= p.y - 3){
        const result=response('navigate',{...cave.target,range:0,bridge:false,excavate:false,maxDrop:1},'Explore a cave through steps that can also be climbed on the return trip.');
        if(!blocked(result.action))return result;
      }
    }
    // Reacquire surface resources after cave work using a supported ascending staircase.
    const ascending=!ore&&preferred?.position.y>p.y+2;
    // Staircases remove adjacent headroom, never the supporting block under the bot.
    if ((ore || ascending) && digStaircase && hasPickaxe(0)) {
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      if (!heading) heading = dirs[Math.abs([...String(client.options?.username || '')].reduce((a, c) => a + c.charCodeAt(0), 0)) % 4];
      const ranked = [heading, ...dirs.filter(d => d !== heading)].sort((a, b) => preferred ? distance({ x: p.x + a[0], y: p.y, z: p.z + a[1] }, preferred.position) - distance({ x: p.x + b[0], y: p.y, z: p.z + b[1] }, preferred.position) : 0);
      const candidates = pendingStep ? [pendingStep] : [
        ...ranked.map(([dx, dz]) => ({ x: p.x + dx, y: ascending?p.y+1:p.y > destinationY ? p.y - 1 : p.y, z: p.z + dz })),
        ...(!ascending&&p.y>destinationY?ranked.map(([dx,dz])=>({x:p.x+dx,y:p.y,z:p.z+dz})):[])
      ];
      for (const next of candidates) {
        if (!isFullBlock(getBlock({ ...next, y: next.y - 1 })) || visited.some(v => key(v) === key(next))) continue;
        // A jump needs clearance above the current head as well as at its destination.
        const overhead={...p,y:p.y+2};
        if(ascending&&!isAir(getBlock(overhead))){
          if(!safeDig(overhead))continue;
          const opening=response('dig',{...overhead,block:rid(getBlock(overhead).name)},'Open safe overhead clearance before climbing toward surface resources.');
          opening.priority=Math.max(priority,81);if(blocked(opening.action))continue;pendingStep=next;return opening;
        }
        const cells = []; for (let y = Math.max(p.y + 1, next.y + 1); y >= next.y; y--) cells.push({ ...next, y });
        if (cells.some(c => !isAir(getBlock(c)) && !safeDig(c))) continue;
        const cell = cells.find(c => !isAir(getBlock(c)));
        const result = cell ? response('dig', { ...cell, block: rid(getBlock(cell).name) }, `Open a supported ${ascending?'ascending':'mining'} passage for ${item}.`) : response('navigate', { ...next, range: 0, maxDrop:1 }, `Follow the supported staircase toward ${ascending?preferred.position.y:destinationY}.`);
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
        const result=response('navigate',{...exit,range:0,bridge:false,excavate:true,maxDrop:2},"Go back to a certain step from the impasse and pick another way.");
        result.priority=Math.max(priority,81);if(!blocked(result.action))return result;
      }
    }
    const searchOptions = { position: p, getBlock, mode: ore ? 'ores' : 'surface', visited, radius: 24, maxNodes: 800, maxCandidates: 8, maxDrop:1, candidateCost: target => learnedCost({skill:'navigate',args:{...target,range:0}}) + (preferred ? Math.max(0, 24 + distance(target, preferred.position) - distance(p, preferred.position)) / 3 : 0) };
    const search = explorationPlanner ? explorationPlanner.poll({ ...searchOptions, context: item + ':' + (preferred ? key(preferred.position) : '') }) : planExploration(searchOptions);
    if (search.status === 'pending') return { action: null, reason: search.reason };
    if (search.status === 'planned') {
      const result = response('navigate', { ...search.target, range: 0, maxDrop:1 }, search.reason);
      if (!blocked(result.action)) return result;
    }
    return { action: null, reason: `No safe source available ${item}; unknown cups and dangerous passageways are not considered as a route.` };
  }

  function ensure(item, amount, ancestors = []) {
    item = rid(item); const missing = Math.max(0, amount - count(o, item)); if (!missing) return null;
    if (ancestors.includes(item) || ancestors.length >= 16) return { action: null, reason: `Cyclic or too long addiction ${item}.` };
    const next = [...ancestors, item];
    if(trace.length<32)trace.push({item,required:amount,missing,parent:ancestors.at(-1)||null});
    const mobs=mobSources[item.replace(/^minecraft:/,'')];
    if(mobs){
      const drop=o.drops?.find(d=>d.item===item);
      if(drop)return response('collect',{item,entityId:drop.id,origin:drop.position,timeoutMs:6000},`Select Observed ${item}.`);
      const mob=(o.entities||[]).filter(e=>mobs.includes(e.name)&&e.kind!=='player'&&!e.isBaby&&!e.named&&distance(e.position,o.self.position)<=32).sort((a,b)=>distance(a.position,o.self.position)-distance(b.position,o.self.position))[0];
      if(mob){
        const next=distance(mob.position,o.self.position)>2.8?response('navigate',{...floor(mob.position),range:1,bridge:false,sprintJump:false},`Approach the source ${item}.`):response('combat',{entityId:mob.id,maxDistance:5,durationMs:600},`Collect ${item} with observed ${mob.name}.`);
        if(!blocked(next.action))return next;
      }
      return explore(item);
    }
    const smelting=furnaceRecipe(item);
    // Nether gold drops nuggets. Do not search for Overworld raw gold while nine nuggets are ready.
    const craftInstead=recipesFor(item).some(r=>{
      const available={...o.inventory};for(const g of r.ingredients){let needed=g.count*Math.ceil(missing/r.output.count);for(const choice of g.choices){const n=Math.min(needed,available[choice]||0);available[choice]=(available[choice]||0)-n;needed-=n;}if(needed)return false;}return true;
    })||o.dimension==='minecraft:the_nether'&&item===rid('gold_ingot');
    if (smelting&&!craftInstead) {
      const inputs=smelting.inputs.filter(n=>catalog.item(rid(n))).sort((a,b)=>estimate(rid(a),1,next)-estimate(rid(b),1,next));
      const raw = inputs.find(n => count(o, n)) || inputs[0];
      if(!raw)return {action:null,reason:`No input for smelting ${item}.`};
      const inputCount = Math.min(missing, 2);
      const dependency = ensure(raw, inputCount, next); if (dependency) return dependency;
      const coal = ['coal', 'charcoal'].find(n => count(o, n) >= Math.ceil(inputCount/fuelItems(n)));
      let fuel = coal;
      if (!fuel) {
        const planks = taxonomy.members('planks').filter(n=>fuelItems(n.replace(/^minecraft:/,''))>0).sort((a, b) => estimate(a, inputCount) - estimate(b, inputCount)); fuel = planks[0];
        if (!fuel) return { action: null, reason: "No fuel recipe available." };
        const dep = ensure(fuel, inputCount, next); if (dep) return dep;
      }
      if (!station(rid('furnace'))) {
        const dependency = ensure('furnace', 1, next); if (dependency) return dependency;
        return response('ensureStation', { station: 'furnace', gather: false }, `Set the smelting furnace ${item}.`);
      }
      return response('smelt', { item, count: inputCount, input: rid(raw), fuel: rid(fuel) }, `Smelt ${item} and check the furnace results.`);
    }
    let sources = knownSources(item);
    if (sourcesByItem.has(item) && !taxonomy.has(item, 'planks')) {
      const minTier = item === rid('obsidian') || item === rid('ancient_debris') ? 3 : item === rid('diamond') || item === rid('raw_gold') || item === rid('redstone') ? 2 : item === rid('raw_iron') || item === rid('lapis_lazuli') ? 1 : taxonomy.has(item, 'logs') ? -1 : sources.some(s => s.tools.length) || /(?:coal|cobblestone|cobbled_deepslate)$/.test(item) ? 0 : -1;
      if (minTier >= 0 && !hasPickaxe(minTier)) { const dep = ensure(pickaxes[minTier], 1, next); if (dep) return dep; }
      // A visible local face wins over a nearer buried cell and remote cave descent.
      const ready=new Set();
      if(client?.world){const eye={...o.self.position,y:o.self.position.y+1.62};
        const ranked=sources.map((s,index)=>{const target={x:s.position.x+.5,y:s.position.y+.5,z:s.position.z+.5},d=distance(eye,target);
          const visible=d<=8.5&&Math.abs(s.position.y-o.self.position.y)<=2&&!unreachable.has(key(s.position))&&safeDig(s.position)&&traceVisibility({origin:eye,target,maxDistance:8.5,getBlock:p=>key(p)===key(s.position)?{shapes:[]}:getBlock(p)}).visible;
          if(visible)ready.add(s);return {s,index,rank:visible?(d<=4.3?0:1):2};});
        sources=ranked.sort((a,b)=>a.rank-b.rank||a.index-b.index).map(r=>r.s);
      }
      // Prefer extending a local mine over chasing an exposed cave face many
      // levels below the surface, for which ordinary walking cannot find a path.
      if(exploration&&digStaircase&&client?.world&&minTier>=0&&sources.length&&sources.every(s=>s.position.y<o.self.position.y-4))return explore(item,sources[0]);
      if(exploration&&digStaircase&&client?.world&&taxonomy.has(item,'logs')&&!ready.size&&sources.length&&sources.every(s=>s.position.y>o.self.position.y+2))return explore(item,sources[0]);
      // Basic building stone is under local soil: do not exhaust distant cave-face
      // candidates before opening a short, supported mining staircase.
      if(exploration&&digStaircase&&client?.world&&/^(minecraft:)?(cobblestone|cobbled_deepslate)$/.test(item)){
        const eye={...o.self.position,y:o.self.position.y+1.62};
        const immediate=ready.size>0||sources.some(s=>{
          const target={x:s.position.x+.5,y:s.position.y+.5,z:s.position.z+.5};
          return distance(eye,target)<=4.3&&safeDig(s.position)&&traceVisibility({origin:eye,target,maxDistance:4.3,getBlock:p=>key(p)===key(s.position)?{shapes:[]}:getBlock(p)}).visible;
        });
        if(!immediate)return explore(item,sources[0]);
      }
      for (const source of sources) {
        const suspended=source.position.y>o.self.position.y+4&&isAir(getBlock({...source.position,y:source.position.y-1}))&&isAir(getBlock({...source.position,y:source.position.y-2}));
        if(client?.world&&client.registry&&minTier>=0&&(suspended||elevation?.key===key(source.position))){
          const access=planResourcePillar({position:o.self.position,target:source.position,getBlock,previous:elevation?.key===key(source.position)?elevation:null,
            canPlace:p=>!client.protection||client.protection.check({operation:'place',dimension:o.dimension,position:p,getBlock}).allowed,
            owned:p=>client.pillarBlocks?.has(`${o.dimension}/${p.x},${p.y},${p.z}`),entities:(o.entities||[]).filter(e=>String(e.id)!==String(client.state?.entityId))});
          if(access.status==='planned'){
            elevation={...access,key:key(source.position)};state.elevatedAccess=access;
            if(!client.state.onGround)return {action:null,reason:'Wait for a confirmed landing before elevated resource access.'};
            const materials=bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block.fromStateId(id,0),dimension:o.dimension});
            const available=materials.reduce((n,m)=>n+m.count,0);
            if(available<access.blocksNeeded){
              if(access.top.y>access.base.y)return response('descendPillar',{count:Math.min(8,access.top.y-access.base.y)},'Return down the verified column to replenish construction blocks.');
              if(Math.hypot(o.self.position.x-access.base.x-.5,o.self.position.z-access.base.z-.5)>6)return response('navigate',{...access.base,range:0,bridge:false,maxDrop:1},'Approach the supported staging area for an elevated resource.');
              const soil=constructionSoil({position:o.self.position,base:access.base,getBlock,canDig:safeDig});
              if(soil)return response('dig',{...soil,block:rid(getBlock(soil).name)},`Prepare construction blocks: ${available}/${access.blocksNeeded}, including a drop-catching platform.`);
              return {action:null,reason:'The elevated resource requires additional safe construction material.'};
            }
            if(Math.hypot(o.self.position.x-access.top.x-.5,o.self.position.z-access.top.z-.5)>.35||Math.abs(o.self.position.y-access.top.y)>.1)return response('navigate',{...access.top,range:0,bridge:false,maxDrop:1},'Reach the base or confirmed top of the resource column.');
            if(access.needCatch&&access.top.y>=access.stagingY){
              if(access.top.y>access.stagingY)return response('descendPillar',{count:Math.min(8,access.top.y-access.stagingY)},'Reach the underside of the resource before placing its drop-catching platform.');
              return response('place',{...access.catchBlock,block:materials[0].block},'Place a catch block against the underside of the resource before the final ascent.');
            }
            const rise=(access.needCatch?access.stagingY:source.position.y)-access.top.y;
            if(rise>0)return response('pillar',{count:Math.min(8,rise)},'Jump-place a verified side column toward the observed resource.');
          }
        }
        if (unreachable.has(key(source.position))) continue;
        const actual = getBlock(source.position);
        if (client?.world && (!actual || !safeDig(source.position))) continue;
        if(client?.world&&taxonomy.has(item,'logs')){
          const eye={...o.self.position,y:o.self.position.y+1.62},target={x:source.position.x+.5,y:source.position.y+.5,z:source.position.z+.5};
          if(distance(eye,target)<=8.5){
            const ray=traceVisibility({origin:eye,target,maxDistance:8.5,getBlock:p=>key(p)===key(source.position)?{shapes:[]}:getBlock(p)});
            const p=ray.reason==='blocked'&&ray.position,b=p&&getBlock(p);
            const leaves=b&&taxonomy.has(rid(b.name),'leaves'),surfaceSoil=b&&source.position.y>o.self.position.y&&/^(?:dirt|rooted_dirt|grass_block|podzol|mycelium)$/.test(b.name);
            if(b&&(leaves||surfaceSoil)&&safeDig(p)&&distance(eye,{x:p.x+.5,y:p.y+.5,z:p.z+.5})<=4.3){
              const opening=response('dig',{...p,block:rid(b.name)},leaves?'Clear reachable leaves covering a nearby trunk.':'Clear safe soil obstructing the final approach to a surface trunk.');
              if(!blocked(opening.action))return opening;
            }
          }
        }
        // Buried resources are remembered, but are approached by excavation, never by teleport or a fictitious path.
        if (actual && ![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([x, y, z]) => isAir(getBlock({ x: source.position.x + x, y: source.position.y + y, z: source.position.z + z })))) continue;
        const result = response('dig', { ...source.position, block: source.block }, `Collect ${item} of observed ${source.block}.`);
        if (!blocked(result.action)) {
          if(peer){
            const resource=`block/${o.dimension}/${source.position.x}/${source.position.y}/${source.position.z}`;
            const owner=peer.owner(resource);
            if(owner&&owner!==peer.id)continue;
            if(claim!==resource){releaseClaim();claim=resource;peer.claim(resource,{bid:distance(source.position,o.self.position)/8+learnedCost(result.action),ttlMs:30000});}
            if(!peer.owns(resource))return {action:null,reason:"Harmonization of resource with other agents."};
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
      const action={skill:'craft',args:{item,count:Math.min(64,missing),...(typeof recipe.id==='string'?{recipeId:recipe.id}:{})}};
      return { recipe, requirements, score: requirements.reduce((n, r) => n + estimate(r.item, r.count, next), 0) + learnedCost(action) + (blocked(action)?1e5:0) };
    }).sort((a, b) => a.score - b.score);
    if (!recipes.length) return { action: null, reason: `There is no supported way to get ${item}.` };
    const chosen = recipes[0];
    const entry=trace.findLast(t=>t.item===item);if(entry){entry.recipeId=chosen.recipe.id;entry.ingredients=chosen.requirements;entry.alternatives=recipes.slice(0,4).map(r=>({recipeId:r.recipe.id,cost:r.score}));}
    // Collect a batch before returning to the workstation. Walking back after
    // every mined block prevented an excavation from ever advancing.
    for (const required of chosen.requirements) { const dependency = ensure(required.item, required.count, next); if (dependency) return dependency; }
    if (chosen.recipe.station && !station(chosen.recipe.station)) {
      const dependency = ensure(chosen.recipe.station, 1, next); if (dependency) return dependency;
      return response('ensureStation', { station: chosen.recipe.station.replace(/^minecraft:/, ''), gather: false }, "Set up the required workstation.");
    }
    return response('craft', { item, count: Math.min(64, missing), recipeId: chosen.recipe.id, gather:false }, `Craft ${item} from confirmed supplies and a usable workstation.`);
  }

  const reactor = { id: 'overmind:survival', apiVersion: 1, failureScope: 'action', managesRetries: Boolean(actionEvidence),
    react(observation) {
      countCache.clear();blockCache.clear();
      o = observation; selected = null;
      if (!finitePoint(o.self?.position) || o.self.health == null || o.self.health <= 0) return { action: null, reason: "Survival is waiting for a live bot and position." };
      evaluations = 0; estimates = new Map(); trace = []; learnedCosts.clear(); evidenceChecks.clear(); updateMemory();
      sourceCache.clear(); observedByBlock.clear();
      for (const block of memory.values()) {
        if (!observedByBlock.has(block.name)) observedByBlock.set(block.name, []);
        observedByBlock.get(block.name).push(block);
      }
      goal={...explicit};
      for(const [selector,n]of classes){
        const members=taxonomy.members(selector.slice(1)).filter(id=>catalog.item(id)),owned=members.reduce((sum,id)=>sum+count(o,id),0);if(owned>=n)continue;
        const nearby=members.flatMap(item=>knownSources(item).filter(source=>!unreachable.has(key(source.position))&&!blocked(response('dig',{...source.position,block:source.block},"Check Class Source.").action)).map(source=>({item,distance:sourceDistance(source.position)+learnedCost({skill:'dig',args:{...source.position,block:source.block}})}))).sort((a,b)=>a.distance-b.distance);
        const item=nearby[0]?.item||members.sort((a,b)=>count(o,b)-count(o,a))[0];goal[item]=Math.max(goal[item]||0,count(o,item)+n-owned);
      }
      const remaining = Object.entries(goal).filter(([item, n]) => count(o, item) < n);
      state = { ...state, targets: { ...goal }, completed: [...milestones], knownResources: memory.size, remaining: Object.fromEntries(remaining) };
      if (!remaining.length) { state = { ...state, status: 'completed', stage: null, reason: "The entire target set is confirmed by the current inventory." }; return { action: null, reason: state.reason }; }
      const limit = targets?0:target === 'wood' ? 1 : target === 'stone_tools' ? 4 : 5;
      const stage = basicStages.slice(0, limit).find(s => !milestones.has(s));
      state.stage = stage || remaining[0][0];
      let result = ensure(stage || remaining[0][0], stage ? 1 : remaining[0][1]);
      if (!result) result = { action: null, reason: "We need a new surveillance for the next step." };
      if (result.action && blocked(result.action)) result = { action: null, reason: "Pause before repetition of a particular failure." };
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
        if(actionEvidence && o?.dimension)actionEvidence.record({agentId:evidenceAgent,dimension:o.dimension,action,failure:result.failure||{code:'ACTION_FAILED'}});
        // Structured transport failures use the evidence memory. Legacy adapters
        // keep their existing route cache until they can supply certificates.
        if(!result.failure&&action.skill==='navigate'&&client?.world&&finitePoint(action.args)&&o?.self?.position&&/route|routes|path|path|route/i.test(result.detail||'')){
          const from=floor(client.state?.position||o.self.position),to=floor(action.args);
          unreachableRoutes.set(id,{from,to,revision:client.world.revision,stamp:routeStamp(from,to)});
          while(unreachableRoutes.size>256)unreachableRoutes.delete(unreachableRoutes.keys().next().value);
        }
        // A timer does not make an unreachable block reachable. Reconsider it after
        // movement or a block change; meanwhile excavate a new approach or explore.
        const unreachableFailure=['NO_PATH','START_UNSUPPORTED','SEARCH_BUDGET','STEP_STALLED'].includes(result.failure?.code)||/reachable|achievable|route|path|\u0434\u043e\u0441\u0442\u0438\u0436\u0438\u043c\u043e\u0439|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u043f\u0443\u0442\u0438/i.test(result.detail||'');
        if (action.skill === 'dig' && unreachableFailure && finitePoint(action.args) && o?.self?.position) {
          unreachable.set(key(action.args), {position: floor(action.args), from: {...o.self.position}, block: getBlock(action.args)?.name});
          while (unreachable.size > 256) unreachable.delete(unreachable.keys().next().value);
        }
        const attempts = (failures.get(id)?.attempts || 0) + 1;
        failures.set(id, { attempts, until: clock() + Math.min(120000, 2000 * 2 ** Math.min(6, attempts - 1)) });
        state.lastFailure = { action, message: String(result.detail || "Unable to act.").slice(0, 300), attempts, ...(result.failure?{failure:result.failure}:{}) };
        if (action.skill === 'navigate') { const p = floor(action.args); visited.push(p); if (visited.length > 512) visited.shift(); pendingStep = null; }
        while (failures.size > 256) failures.delete(failures.keys().next().value);
      } else failures.delete(id);
    },
    snapshot: () => structuredClone(state),
    attach(core) { const detach=attachResults(reactor, core); return ()=>{detach();releaseClaim();}; }
  }; return reactor;
}
