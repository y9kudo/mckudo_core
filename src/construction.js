import { jsonCopy } from './config.js';
import { resourceId } from './catalog.js';
import {isAir,isFullBlock} from './navigation.js';
export const blockKey = p => `${p.x},${p.y},${p.z}`;
const coords = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);

export function createShelterBlueprint({ origin = { x: 0, y: 64, z: 0 }, width = 5, depth = 5, height = 3, material = 'minecraft:oak_planks', door = 'minecraft:oak_door' } = {}) {
  if (!coords(origin) || ![width, depth].every(n => Number.isInteger(n) && n >= 3 && n <= 11) || !Number.isInteger(height) || height < 3 || height > 5) throw new Error("Shelter: integer coordinates, width/depth 3–11, altitude 3–5.");
  material = resourceId(material); door = resourceId(door);
  const cells = [], air = [], entrance = Math.floor(width / 2);
  const at = (x, y, z) => ({ x: origin.x + x, y: origin.y + y, z: origin.z + z });
  for (let y = 0; y <= height + 1; y++) for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    const p = at(x, y, z), opening = x === entrance && z === 0 && (y === 1 || y === 2);
    if (opening) continue;
    if (y === 0 || y === height + 1 || x === 0 || z === 0 || x === width - 1 || z === depth - 1) cells.push({ ...p, block: material });
    else air.push(p);
  }
  cells.push({ ...at(entrance, 1, 0), block: door });
  const dependent = [{ ...at(entrance, 2, 0), block: door }];
  return { schemaVersion: 1, id: 'shelter', origin: { ...origin }, size: { width, depth, height }, cells, dependent, air };
}

/** A compact covered home on existing natural ground, with a two-block door. */
export function createGroundShelterBlueprint({origin={x:0,y:64,z:0},width=3,depth=4,height=3,material='minecraft:oak_planks',door='minecraft:oak_door'}={}){
  if(!coords(origin)||![width,depth].every(n=>Number.isInteger(n)&&n>=3&&n<=11)||!Number.isInteger(height)||height<3||height>5)throw new Error("Home: incorrect coordinates or size.");
  material=resourceId(material);door=resourceId(door);
  const cells=[],air=[],entrance=Math.floor(width/2),at=(x,y,z)=>({x:origin.x+x,y:origin.y+y,z:origin.z+z});
  for(let y=0;y<=height;y++)for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
    const p=at(x,y,z),wall=x===0||z===0||x===width-1||z===depth-1,opening=x===entrance&&z===0&&y<2;
    if(opening)continue;
    if(y===height||wall)cells.push({...p,block:material});else air.push(p);
  }
  cells.push({...at(entrance,0,0),block:door});
  return validateBlueprint({schemaVersion:1,id:'ground-shelter',origin:{...origin},size:{width,depth,height},cells,dependent:[{...at(entrance,1,0),block:door}],air});
}

/** Only choose an observed, flat, unoccupied site with support under every cell. */
export function findGroundShelterSite({near,getBlock,width=3,depth=4,height=3,radius=8,maxRise=20}={}){
  if(!near||!['x','y','z'].every(k=>Number.isFinite(near[k]))||typeof getBlock!=='function'||![width,depth].every(n=>Number.isInteger(n)&&n>=3&&n<=11)||!Number.isInteger(height)||height<3||height>5||!Number.isInteger(radius)||radius<0||radius>32||!Number.isInteger(maxRise)||maxRise<0||maxRise>64)throw new Error("Searching for home: near, getBlock, dimensions, radius and maxRise.");
  const center={x:Math.floor(near.x),y:Math.floor(near.y),z:Math.floor(near.z)},offsets=[];
  for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++)offsets.push([dx,dz]);
  offsets.sort((a,b)=>a[0]**2+a[1]**2-b[0]**2-b[1]**2);
  for(let dy=0;dy<=maxRise;dy++)for(const [dx,dz]of offsets){
    const origin={x:center.x+dx-Math.floor(width/2),y:center.y+dy,z:center.z+dz-Math.floor(depth/2)};
    let clear=true;
    for(let x=0;x<width&&clear;x++)for(let z=0;z<depth&&clear;z++){
      const p={x:origin.x+x,y:origin.y,z:origin.z+z};
      if(!isFullBlock(getBlock({...p,y:p.y-1})))clear=false;
      // Traversable grass/flowers are not empty construction cells.
      for(let y=0;y<=height&&clear;y++)if(!['air','cave_air','void_air'].includes((getBlock({...p,y:p.y+y})?.name||'').replace(/^minecraft:/,'')))clear=false;
    }
    if(clear)return origin;
  }
  return null;
}

export function validateBlueprint(input) {
  const b = jsonCopy(input,'$',1048576);
  if (b.schemaVersion !== 1 || !Array.isArray(b.cells) || !b.cells.length || b.cells.length > 4096 || !Array.isArray(b.air || []) || !Array.isArray(b.dependent || [])) throw new Error("Blueprint: I need a format 1 and 1–4096 blocks.");
  const occupied = new Set();
  for (const cell of [...b.cells, ...(b.dependent || []), ...(b.air || [])]) {
    if (!coords(cell) || occupied.has(blockKey(cell))) throw new Error("Blueprint: incorrect or repeated coordinates.");
    occupied.add(blockKey(cell));
    if (cell.block !== undefined) cell.block = resourceId(cell.block);
  }
  if (b.cells.some(c => !c.block)) throw new Error("Every cell needs block.");
  return b;
}
export function billOfMaterials(blueprint) {
  const b = validateBlueprint(blueprint), counts = {};
  for (const c of b.cells) counts[c.block] = (counts[c.block] || 0) + 1;
  return counts;
}

/** Pure planning only. The application supplies observations, the core supplies actions. */
export function planConstruction(blueprint, { blocks, inventory = {} }) {
  const b = validateBlueprint(blueprint), missing = [], conflicts = [], unknown = [];
  const read = c => blocks[blockKey(c)];
  for (const c of b.cells) {
    const value = read(c);
    if (value == null) unknown.push(blockKey(c));
    else if (value === c.block) continue;
    else if (!['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(value)) conflicts.push({ position: blockKey(c), expected: c.block, actual: value });
    else missing.push(c);
  }
  for (const c of b.air || []) {
    const value = read(c);
    if (value == null) unknown.push(blockKey(c));
    else if (!['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(value)) conflicts.push({ position: blockKey(c), expected: 'minecraft:air', actual: value });
  }
  if (unknown.length || conflicts.length) return { status: 'blocked', reason: unknown.length ? "Part of the site is not observed." : "The area is occupied; Automatic destruction of existing construction is prohibited.", unknown, conflicts, actions: [] };
  const materials = {};
  for (const c of missing) materials[c.block] = (materials[c.block] || 0) + 1;
  const shortages = Object.fromEntries(Object.entries(materials).map(([id, n]) => [id, Math.max(0, n - (inventory[id] || 0))]).filter(([, n]) => n));
  if (Object.keys(shortages).length) return { status: 'needs-materials', shortages, materials, actions: [] };
  if (!missing.length) {
    const incomplete = (b.dependent || []).filter(c => read(c) !== c.block);
    if (incomplete.length) return { status: 'blocked', reason: "Unproven composite blocks (e.g. top of door).", actions: [] };
    return { status: 'completed', materials: {}, actions: [] };
  }
  return { status: 'ready', materials, actions: missing.map(c => ({ skill: 'place', args: { block: c.block, x: c.x, y: c.y, z: c.z } })) };
}

export function createConstructionReactor({ blueprint, priority = 20 }) {
  const b = validateBlueprint(blueprint);
  return { id: 'overmind:construction', apiVersion: 1, react(observation) {
    const plan = planConstruction(b, { blocks: observation.world?.blocks || {}, inventory: observation.inventory || {} });
    if (plan.status !== 'ready') return { action: null, reason: plan.reason || plan.status };
    const action = plan.actions[0];
    return { action, priority, reason: `Set ${action.args.block} in ${blockKey(action.args)}.` };
  } };
}
