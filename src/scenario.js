import { jsonCopy } from './config.js';
import { createBlockTaxonomy } from './taxonomy.js';
import { createResourceReactor, planExploration } from './exploration.js';
import { createNetherPortalBlueprint, planNetherPortal, observedNetherPortalFrame, triangulateEyes, fortressEvidence, dragonDecision } from './endgame.js';
import {blockKey,createGroundShelterBlueprint,findGroundShelterSite,planConstruction} from './construction.js';
import {recordHomeTrail,homeReturnWaypoint} from './home-route.js';
const fields = { resources: ['targets'], netherResources:['targets','exploreDistance'], shelter:[], swim:['position'], navigate: ['position','range','bridge','excavate'], collect: ['item', 'count'], netherPortal: ['origin', 'axis'], travel: ['dimension'], blazeRods: ['count'], enderPearls: ['count'], eyes: ['count'], stronghold: [], endPortal: [], dragon: [] };
const namespaced = s => typeof s === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s);
export function validateScenario(input) {
  const s = jsonCopy(input);
  const keys = (o, allowed, path) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !allowed.includes(k))) throw new Error(`${path}: unknown field or incorrect object.`); };
  keys(s, ['schemaVersion', 'name', 'steps'], 'scenario');
  if (s.schemaVersion !== 1 || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || !Array.isArray(s.steps) || !s.steps.length || s.steps.length > 64) throw new Error("Scenario: schemaVersion 1, name and 1–64 steps.");
  const ids = new Set();
  for (const step of s.steps) {
    if (!step || !Object.hasOwn(fields, step.type)) throw new Error(`Unknown type of phase: ${step?.type}.`);
    keys(step, ['id', 'type', ...fields[step.type]], `steps.${step.id}`);
    if (typeof step.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(step.id) || ids.has(step.id)) throw new Error("The stages must have unique id: a-z, 0-9, _ or -.");
    ids.add(step.id);
    if (step.type === 'resources'||step.type==='netherResources') {
      if (!step.targets || typeof step.targets !== 'object' || Array.isArray(step.targets) || !Object.keys(step.targets).length || Object.keys(step.targets).length > 32 || Object.entries(step.targets).some(([k, n]) => !(namespaced(k) || /^#[a-z0-9_:.-]+$/.test(k)) || !Number.isInteger(n) || n < 1 || n > 4096)) throw new Error("resources.targets: ID/#grade and number 1–4096.");
    }
    if(step.type==='netherResources'&&step.exploreDistance!==undefined&&(!Number.isFinite(step.exploreDistance)||step.exploreDistance<0||step.exploreDistance>128))throw new Error('netherResources.exploreDistance: 0–128 blocks.');
    if(step.type==='navigate'||step.type==='swim'){
      keys(step.position,['x','y','z'],`steps.${step.id}.position`);
      if(!['x','y','z'].every(k=>Number.isInteger(step.position[k])&&Math.abs(step.position[k])<=30000000))throw new Error("navigate.position: integer coordinates x, y, z within the world.");
      if(step.range!==undefined&&(!Number.isInteger(step.range)||step.range<0||step.range>8))throw new Error("navigate.range: an integer 0–8.");
      for(const k of ['bridge','excavate'])if(step[k]!==undefined&&typeof step[k]!=='boolean')throw new Error(`navigate.${k}: true or false.`);
    }
    if (['collect', 'blazeRods', 'enderPearls', 'eyes'].includes(step.type) && (!Number.isInteger(step.count) || step.count < 1 || step.count > 64)) throw new Error(`${step.type}.count: 1–64.`);
    if (step.type === 'collect' && !namespaced(step.item)) throw new Error('collect.item: namespace:id.');
    if (step.type === 'netherPortal' && step.origin) createNetherPortalBlueprint(step);
    if (step.type === 'netherPortal' && step.axis !== undefined && !['x', 'z'].includes(step.axis)) throw new Error("axis: x or z.");
    if (step.type === 'travel' && !['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].includes(step.dimension)) throw new Error("Unknown dimension travel.dimension.");
  }
  return s;
}

/** A scenario is a reactor/controller, not a Minecraft client. The application owns both. */
export function createScenario({ scenario, catalog, taxonomy = createBlockTaxonomy(catalog), stations = {}, getBlock, explorationRadius = 24, resourceFactory, navigationFactory, strongholdSearch, dragonCombat, explorationPlanner,netherFactory,memory,isOutdoor }) {
  const definition = validateScenario(scenario), completed = [], resources = new Map(), origins = new Map(), shelters=new Map(), visited = [], portals = new Map();
  const navigation=new Map(),nether=new Map();let activeNether=null;
  let homeAnchor=memory?.homeAnchor??null;
  const homeTrail=structuredClone(memory?.homeTrail||[]);
  if(!Array.isArray(homeTrail)||homeTrail.length>2048||homeTrail.some(p=>!p||!['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000)))throw new Error('Invalid scenario home trail.');
  if(homeAnchor&&(!['x','y','z'].every(k=>Number.isInteger(homeAnchor[k])&&Math.abs(homeAnchor[k])<=30000000)))throw new Error('Invalid scenario home anchor.');
  let index = 0, activeResource = null, activeNavigation=null, state = { status: 'pending', current: definition.steps[0].id, completed: [], reason: "Waiting for observation." };
  if(memory){
    if(memory.schemaVersion!==1||JSON.stringify(memory.definition)!==JSON.stringify(definition)||!Array.isArray(memory.completed)||memory.completed.some((id,n)=>id!==definition.steps[n]?.id)||!Array.isArray(memory.portals)||memory.portals.length>128||memory.portals.some(b=>!['minecraft:overworld','minecraft:the_nether','minecraft:the_end'].includes(b.dimension)||!['minecraft:nether_portal','minecraft:end_portal'].includes(b.name)||!b.position||!['x','y','z'].every(k=>Number.isInteger(b.position[k])&&Math.abs(b.position[k])<=30000000)))throw new Error("Wrong scenario reference point or other scenario.");
    completed.push(...memory.completed);index=completed.length;
    // A previous segment's dragon result is not a new server death observation.
    if(definition.steps[index-1]?.type==='dragon'){completed.pop();index--;}
    for(const b of memory.portals)portals.set(b.dimension+'/'+blockKey(b.position),jsonCopy(b));
    state={...state,current:definition.steps[index]?.id??null,completed:[...completed]};
  }
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
    if (!getBlock || !o.self?.position) return idle("For research, connect getBlock(position).");
    const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(o.self.position[k])]));
    if (!visited.some(v => blockKey(v) === blockKey(p))) { visited.push(p); if (visited.length > 256) visited.shift(); }
    const args = { getBlock, position: p, visited, radius: explorationRadius, mode, ...(toward ? { candidateCost: q => Math.min(1000, Math.max(0, 32 + Math.hypot(q.x-toward.x,q.z-toward.z)-Math.hypot(p.x-toward.x,p.z-toward.z))) } : {}) };
    const route = explorationPlanner ? explorationPlanner.poll({ ...args, context: 'scenario:' + definition.steps[index]?.id }) : planExploration(args);
    return route.status === 'planned' ? act('navigate', route.target, route.reason) : idle(route.reason);
  };
  const collect = (item, o) => {
    const drop = o.drops?.find(d => d.item === item);
    return drop ? act('collect', { item, origin: drop.position, radius: 12, timeoutMs: 8000 }, `Select ${item} with confirmation of equipment.`, 100) : null;
  };
  const seekLoot = (item, mob, n, o) => {
    if ((o.inventory[item] || 0) >= n) return null;
    const pickup = collect(item, o); if (pickup) return pickup;
    const target = (o.entities || []).find(e => e.name === mob && e.kind !== 'player' && Math.hypot(e.position.x - o.self.position.x, e.position.y - o.self.position.y, e.position.z - o.self.position.z) <= 32);
    if (target) {
      if(Math.hypot(target.position.x-o.self.position.x,target.position.y-o.self.position.y,target.position.z-o.self.position.z)>2.8)return act('navigate',{...Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(target.position[k])])),range:1,bridge:false,sprintJump:false},`Approaching the Observed ${mob}.`,100);
      return act('combat', { entityId: target.id, maxDistance: 4, durationMs: 600 }, `Gathering ${item}: Fight the Witness ${mob}.`, 100);
    }
    return explore(o);
  };
  const reactStep = (step, o) => {
    if(step.type==='swim'){
      const p=o.self?.position,target={x:step.position.x+.5,y:step.position.y+.05,z:step.position.z+.5};
      if(!p)return idle("Navigation requires a observed position.");
      if(Math.hypot(p.x-target.x,p.y-target.y,p.z-target.z)<.55)return null;
      return act('swim',{position:step.position},"Pass the waterway OMVectorize Air Control.");
    }
    const inv = o.inventory || {}, blocks = o.world?.sampledBlocks || [];
    if(step.type==='netherResources'){
      if(o.dimension!=='minecraft:the_nether')return idle("For netherResources First, enter Neser.");
      if(!netherFactory)return idle("Connect netherFactory Or use it createEndExpedition.");
      if(!nether.has(step.id))nether.set(step.id,netherFactory(step,memory?.nether?.[step.id]));
      activeNether=nether.get(step.id);const r=activeNether.react(o);
      return activeNether.snapshot().status==='completed'?null:r;
    }
    if(step.type==='navigate'){
      if(!navigationFactory)return idle("For phase navigate connect navigationFactory; createMinecraftAgent connects it automatically.");
      if(!navigation.has(step.id))navigation.set(step.id,navigationFactory(step));
      activeNavigation=navigation.get(step.id);
      return activeNavigation.react(o);
    }
    if (step.type === 'resources') {
      const owned={...inv};for(const item of Object.values(o.equipment||{}))if(item)owned[item.item]=(owned[item.item]||0)+item.count;
      return enough(step.targets, owned) ? null : supply(step.id, step.targets, o);
    }
    if(step.type==='shelter'){
      if(o.dimension!=='minecraft:overworld'||!getBlock)return idle("Building a house requires observed blocks of the conventional world.");
      if(homeAnchor&&navigationFactory&&o.self.position.y<homeAnchor.y-6&&!isOutdoor?.(o.self.position)){
        const waypoint=homeReturnWaypoint(homeTrail,o.self.position,homeAnchor);let key=step.id+':return-home:'+blockKey(waypoint);
        if(!navigation.has(key))navigation.set(key,navigationFactory({id:key,type:'navigate',position:waypoint,range:0,bridge:false,excavate:homeTrail.length===0}));
        activeNavigation=navigation.get(key);
        if(homeTrail.length&&activeNavigation.snapshot?.().status==='blocked'){
          key+=':excavate';
          if(!navigation.has(key))navigation.set(key,navigationFactory({id:key,type:'navigate',position:waypoint,range:0,bridge:false,excavate:true}));
          activeNavigation=navigation.get(key);
        }
        const result=activeNavigation.react(o);
        if(result)return {...result,reason:'Return to the observed home area before constructing a shelter. '+(result.reason||'')};
      }
      let blueprint=shelters.get(step.id);
      if(!blueprint){
        const site=findGroundShelterSite({near:o.self.position,getBlock});
        if(!site)return explore(o,'surface');
        const nearestLog=blocks.filter(b=>/_log$/.test(b.name)).sort((a,b)=>Math.hypot(a.position.x-o.self.position.x,a.position.z-o.self.position.z)-Math.hypot(b.position.x-o.self.position.x,b.position.z-o.self.position.z))[0]?.name;
        const heldWood=Object.entries(inv).filter(([id,n])=>n>0&&/_(?:log|planks)$/.test(id)).sort((a,b)=>b[1]-a[1])[0]?.[0];
        const wood=(heldWood||nearestLog||'minecraft:oak_log').replace(/^minecraft:/,'').replace(/_(?:log|planks)$/,'');
        blueprint=createGroundShelterBlueprint({origin:site,material:`minecraft:${wood}_planks`,door:`minecraft:${wood}_door`});shelters.set(step.id,blueprint);
      }
      const siteBlocks=Object.fromEntries([...blueprint.cells,...blueprint.air,...blueprint.dependent].map(p=>[blockKey(p),nameAt(p)]));
      const plan=planConstruction(blueprint,{blocks:siteBlocks,inventory:inv});
      if(plan.status==='completed')return null;
      if(plan.status==='blocked'){
        if(plan.conflicts?.length&&!blueprint.cells.some(p=>nameAt(p)===p.block)){shelters.delete(step.id);return idle("The site changed before the building started; Select a new free space.");}
        return idle(plan.reason);
      }
      if(plan.status==='needs-materials')return supply(step.id,Object.fromEntries(Object.entries(plan.shortages).map(([id,n])=>[id,(inv[id]||0)+n])),o);
      const next=plan.actions[0];return act(next.skill,next.args,"Build a house with a door and roof.");
    }
    if (step.type === 'collect') return inv[step.item] >= step.count ? null : collect(step.item, o) || idle(`There's no sign of him in the surveillance ${step.item}.`);
    if (step.type === 'eyes') return inv['minecraft:ender_eye'] >= step.count ? null : supply(step.id, { 'minecraft:ender_eye': step.count }, o);
    if (step.type === 'blazeRods') {
      if (inv['minecraft:blaze_rod'] >= step.count) return null;
      if (o.dimension !== 'minecraft:the_nether') return idle("To find the fritts first, go into Nether.");
      const evidence = fortressEvidence(o);
      if (!evidence.blazes.length && evidence.blocks.length) {
        const p = evidence.blocks[0].position;
        if (Math.hypot(p.x - o.self.position.x, p.z - o.self.position.z) > 8) return act('goto', { ...p, range: 4 }, "Examine observed blocks of possible fortress.");
      }
      return seekLoot('minecraft:blaze_rod', 'blaze', step.count, o);
    }
    if (step.type === 'enderPearls') return seekLoot('minecraft:ender_pearl', 'enderman', step.count, o);
    if (step.type === 'netherPortal') {
      if (!['minecraft:overworld', 'minecraft:the_nether'].includes(o.dimension)) return idle("For the frame Nether-The portal needs another dimension.");
      if (!origins.has(step.id)) {
        let origin = step.origin;
        const base = o.self.position;
        if (!origin && getBlock) for (let dx = 3; dx <= 10 && !origin; dx++) for (let dz = -5; dz <= 5; dz++) {
          const p = { x: Math.floor(base.x) + dx, y: Math.floor(base.y), z: Math.floor(base.z) + dz }, b = createNetherPortalBlueprint({ origin: p, axis: step.axis });
          if ([...b.cells, ...b.air].every(c => ['minecraft:air', 'minecraft:cave_air'].includes(nameAt(c))) && b.cells.filter(c => c.y === p.y).every(c => getBlock({ ...c, y: c.y - 1 })?.boundingBox === 'block')) { origin = p; break; }
        }
        if (!origin) return idle("No observed free area 4×5 Portal support. Can I ask you a question origin.");
        origins.set(step.id, origin);
      }
      const b = createNetherPortalBlueprint({ origin: origins.get(step.id), axis: step.axis });
      const observed = Object.fromEntries([...b.cells, ...b.air].map(p => [blockKey(p), o.world?.blocks?.[blockKey(p)] ?? nameAt(p)]));
      const plan = planNetherPortal({ blueprint: b, blocks: observed, inventory: inv });
      if (plan.status === 'completed') return null;
      if (plan.status === 'needs-materials') return supply(step.id, Object.fromEntries(Object.entries(plan.shortages).map(([id, n]) => [id, (inv[id] || 0) + n])), o);
      return plan.actions.length ? act(plan.actions[0].skill, plan.actions[0].args, "Construction and inspection Nether-portal.") : idle(plan.reason);
    }
    if (step.type === 'travel') {
      if (o.dimension === step.dimension) return null;
      const expected = step.dimension === 'minecraft:the_end' ? 'minecraft:end_portal' : 'minecraft:nether_portal';
      const portal = blocks.find(b => b.name === expected);
      if (portal) return act('enterPortal', { ...portal.position, dimension: step.dimension }, "Enter confirmed active portal.");
      const remembered = [...portals.values()].filter(b => b.dimension === o.dimension && b.name === expected).sort((a,b)=>Math.hypot(a.position.x-o.self.position.x,a.position.z-o.self.position.z)-Math.hypot(b.position.x-o.self.position.x,b.position.z-o.self.position.z))[0];
      if (remembered) {
        const p=remembered.position, actual=getBlock?.(p);
        if(expected==='minecraft:nether_portal'&&actual&&nameAt(p)!==expected){
          const frame=observedNetherPortalFrame({interior:p,getBlock});
          if(frame&&(inv['minecraft:flint_and_steel']||0)>0)return act('ignitePortal',{origin:frame.origin,axis:frame.axis},"Relight the entire back-up frame view.");
          if(Math.hypot(p.x-o.self.position.x,p.y-o.self.position.y,p.z-o.self.position.z)<8)return idle("The reverse portal has been destroyed or destroyed; A whole frame and a light is required for recovery.");
        }
        // Never enter an old coordinate without confirming the current block.
        if (actual && nameAt(p) === expected && Math.hypot(p.x-o.self.position.x,p.y-o.self.position.y,p.z-o.self.position.z)<=96) return act('enterPortal', {...p,dimension:step.dimension}, "Return to previously observed and retested portal.");
        return explore(o,'surface',p);
      }
      return idle(`No matching resource in observed terrain ${expected}.`);
    }
    if (step.type === 'stronghold') {
      if (o.dimension !== 'minecraft:overworld') return idle("Searching for the Fort overworld.");
      if (blocks.some(b => b.name === 'minecraft:end_portal_frame')) return null;
      const flights = o.endgame?.eyes || [], recent = flights.slice(-4), last = flights.at(-1), here = o.self.position;
      if (!last || Math.hypot(here.x - last.launched.x, here.z - last.launched.z) >= 48) {
        if (!(inv['minecraft:ender_eye'] > 0)) return idle("For the next direction measurement, you need Ender's eye.");
        return act('throwEye', {}, "Watching Your own Eye.");
      }
      const estimate = triangulateEyes(recent);
      if (estimate.status === 'estimated' && Math.hypot(here.x - estimate.position.x, here.z - estimate.position.z) < 24) return strongholdSearch?.(o,estimate.position) || explore(o, 'ores');
      const dx = last.end.x - last.origin.x, dz = last.end.z - last.origin.z, length = Math.hypot(dx, dz);
      if (length < 2) return explore(o, 'ores');
      const direction = estimate.status === 'estimated' ? { x: estimate.position.x - here.x, z: estimate.position.z - here.z } : { x: dx / length * 48 - dz / length * 32, z: dz / length * 48 + dx / length * 32 };
      const d = Math.hypot(direction.x, direction.z), scale = Math.min(48, d) / d;
      const x = Math.floor(here.x + direction.x * scale), z = Math.floor(here.z + direction.z * scale);
      if (!getBlock) return idle("You need to find a passage to the fortress getBlock.");
      for (let dy = 4; dy >= -8; dy--) {
        const p = { x, y: Math.floor(here.y) + dy, z };
        if (['minecraft:air', 'minecraft:cave_air'].includes(nameAt(p)) && ['minecraft:air', 'minecraft:cave_air'].includes(nameAt({ ...p, y: p.y + 1 })) && getBlock({ ...p, y: p.y - 1 })?.boundingBox === 'block') return act('goto', { ...p, range: 2 }, "Move in the measured direction and spread the points of the drop.");
      }
      return explore(o, 'ores');
    }
    if (step.type === 'endPortal') {
      if (blocks.some(b => b.name === 'minecraft:end_portal')) return null;
      const frame = blocks.find(b => b.name === 'minecraft:end_portal_frame' && b.properties?.eye === false);
      if (!frame) return idle("Need a visible empty frame of existing End-portal.");
      if (!(inv['minecraft:ender_eye'] > 0)) return idle("Ended up Ender's eyes.");
      return act('fillEndFrame', frame.position, "Fill in the frame and wait for server confirmation.");
    }
    if (step.type === 'dragon') {
      if (dragonCombat) return dragonCombat.react(o);
      const decision = dragonDecision(o);
      if (decision.mode === 'completed') return null;
      if (decision.mode === 'evade') return decision.target ? act('evade', { from: decision.target }, decision.reason, 950) : idle(decision.reason);
      if (['crystal', 'dragon'].includes(decision.mode)) {
        if (!inv['minecraft:bow'] || !inv['minecraft:arrow']) return idle("You need bow and arrows to fight.");
        return act('shoot', { entityId: decision.entityId }, decision.reason, 100);
      }
      if (decision.mode === 'perch') return act('wait', { durationMs: 500 }, "Dragon is perching: Keep your distance and wait for the takeoff.", 100);
      return decision.mode === 'search' ? explore(o) : idle(decision.reason);
    }
  };
  const reactor = { id: 'overmind:scenario', apiVersion: 1, react(o) {
    activeResource=null;activeNavigation=null;activeNether=null;
    if(!homeAnchor&&index===0&&o.dimension==='minecraft:overworld'&&o.self?.position&&['x','y','z'].every(k=>Number.isFinite(o.self.position[k])))homeAnchor=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(o.self.position[k])]));
    if(o.dimension==='minecraft:overworld'&&o.self?.position&&index<=definition.steps.findIndex(s=>s.type==='shelter')&&definition.steps[index]?.type!=='shelter')recordHomeTrail(homeTrail,o.self.position);
    for (const [key,portal] of portals) if(portal.name==='minecraft:end_portal'&&portal.dimension===o.dimension && getBlock?.(portal.position) && nameAt(portal.position)!==portal.name) portals.delete(key);
    for (const b of o.world?.sampledBlocks || []) if (['minecraft:nether_portal','minecraft:end_portal'].includes(b.name)) {
      const key=o.dimension+'/'+blockKey(b.position);portals.delete(key);portals.set(key,{dimension:o.dimension,name:b.name,position:{...b.position}});
    }
    while(portals.size>128)portals.delete(portals.keys().next().value);
    while (index < definition.steps.length) {
      const step = definition.steps[index], response = reactStep(step, o);
      if (response) { state = { status: response.action ? 'running' : 'blocked', current: step.id, completed: [...completed], reason: response.reason }; return response; }
      completed.push(step.id); index++;
    }
    state = { status: 'completed', current: null, completed: [...completed], reason: "All scenario conditions confirmed by observations." }; return idle(state.reason);
  } };
  return { reactor, snapshot: () => jsonCopy(state), definition: () => jsonCopy(definition),
    exportMemory:()=>jsonCopy({schemaVersion:1,definition,completed,homeAnchor,homeTrail,portals:[...portals.values()],nether:{...memory?.nether,...Object.fromEntries([...nether].map(([id,r])=>[id,r.exportMemory()]))}}),
    restart(){index=0;completed.length=0;resources.clear();navigation.clear();nether.clear();activeResource=null;activeNavigation=null;activeNether=null;state={status:'pending',current:definition.steps[0].id,completed:[],reason:"Rechecking of stock after loss of equipment."};},
    recordResult(event,action) { activeResource?.recordResult?.(event,action);activeNavigation?.recordResult?.(event,action);activeNether?.recordResult?.(event,action);if(definition.steps[index]?.type==='dragon')dragonCombat?.recordResult?.(event,action); } };
}
