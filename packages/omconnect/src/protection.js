const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const cell = p => Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(p[k])]));
const key = (dimension, p) => `${dimension}/${p.x},${p.y},${p.z}`;
const name = block => (block?.name || block?.id || '').replace(/^minecraft:/, '');

// These are evidence of a structure, not proof of who built it. Natural structures
// are deliberately treated conservatively too. Logs, leaves and ores are not anchors.
export const isStructureBlock = block => /(?:_planks|_stairs|_slab|_door|_trapdoor|_fence|_fence_gate|_glass|_glass_pane|_bricks|_brick_wall|_bed|_sign|_hanging_sign|_terracotta|_concrete|_wool|_shulker_box)$/.test(name(block)) ||
  /^(?:cobblestone|cobbled_deepslate|stone_bricks|bricks|glass|glass_pane|terracotta|chest|trapped_chest|barrel|furnace|blast_furnace|smoker|crafting_table|smithing_table|brewing_stand|enchanting_table|bookshelf|chiseled_bookshelf|anvil|chipped_anvil|damaged_anvil|hopper|dispenser|dropper|observer|piston|sticky_piston|beacon|bell|lantern|soul_lantern)$/.test(name(block));

function region(input) {
  if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(input.id) || typeof input.dimension !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(input.dimension) || !point(input.min) || !point(input.max)) throw new Error("Protected region: id, dimension and min/max {x,y,z}.");
  const a = cell(input.min), b = cell(input.max);
  return { id: input.id, dimension: input.dimension,
    min: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.min(a[k], b[k])])),
    max: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.max(a[k], b[k])])) };
}

/** Client-side edit policy. Regions are exact; automatic structure detection is a heuristic. */
export class OMProtection {
  #regions = new Map();
  #own = new Map();
  #revision = 0;
  constructor({ regions = [], structures = true, structureRadius = 2 } = {}) {
    if (!Array.isArray(regions) || regions.length > 128 || typeof structures !== 'boolean' || !Number.isInteger(structureRadius) || structureRadius < 0 || structureRadius > 3) throw new Error("Protection: to 128 Areas, structures boolean, structureRadius 0–3.");
    this.structures = structures; this.structureRadius = structureRadius;
    for (const r of regions) { if (this.#regions.has(r?.id)) throw new Error("ID protected areas must be unique."); this.add(r); }
  }
  get revision() { return this.#revision; }
  get regions() { return structuredClone([...this.#regions.values()]); }
  add(input) {
    const r = region(input);
    if (!this.#regions.has(r.id) && this.#regions.size >= 128) throw new Error("The limit of protected areas has been reached.");
    this.#regions.set(r.id, r); this.#revision++; return structuredClone(r);
  }
  remove(id) { const removed = this.#regions.delete(id); if (removed) this.#revision++; return removed; }
  remember(dimension, position, block) {
    if (!point(position) || !name(block)) return;
    this.#own.set(key(dimension, cell(position)), { name: name(block), stateId: block.stateId });
    while (this.#own.size > 4096) this.#own.delete(this.#own.keys().next().value);
    this.#revision++;
  }
  forget(dimension, position) { if (this.#own.delete(key(dimension, cell(position)))) this.#revision++; }
  observeBlockChange(dimension,position,previous,current){
    const own=this.#own.get(key(dimension,cell(position)));if(!own)return;
    const sameName=own.name===name(previous)&&own.name===name(current);
    const sameState=previous?.stateId===current?.stateId;
    const properties=b=>Object.entries(b?.getProperties?.()??{}).filter(([k])=>k!=='lit').sort(([a],[b])=>a.localeCompare(b));
    const lightingOnly=/^(?:furnace|smoker|blast_furnace)$/.test(own.name)&&typeof previous?.getProperties==='function'&&typeof current?.getProperties==='function'&&JSON.stringify(properties(previous))===JSON.stringify(properties(current));
    if(sameName&&(own.stateId===undefined||own.stateId===previous?.stateId)&&(sameState||lightingOnly)){
      if(!sameState)this.remember(dimension,position,current);return;
    }
    this.forget(dimension,position);
  }
  exportMemory(){return {schemaVersion:1,owned:[...this.#own].map(([key,b])=>({key,...b}))};}
  restoreMemory(memory){
    if(memory?.schemaVersion!==1||!Array.isArray(memory.owned)||memory.owned.length>4096)throw new Error('Invalid placement ownership memory.');
    const owned=new Map();
    for(const record of memory.owned){
      if(!record||typeof record.key!=='string'||record.key.length>150||!(/^[a-z0-9_.-]+:[a-z0-9_./-]+\/-?\d+,-?\d+,-?\d+$/.test(record.key))||typeof record.name!=='string'||!(/^[a-z0-9_]+$/.test(record.name))||record.stateId!==undefined&&(!Number.isSafeInteger(record.stateId)||record.stateId<0))throw new Error('Invalid owned block record.');
      if(record.key.slice(record.key.lastIndexOf('/')+1).split(',').some(n=>Math.abs(Number(n))>30000000)||owned.has(record.key))throw new Error('Invalid or duplicate owned block position.');
      owned.set(record.key,{name:record.name,...(record.stateId===undefined?{}:{stateId:record.stateId})});
    }
    this.#own=owned;this.#revision++;
  }
  check({ operation, dimension, position, block, getBlock }) {
    if (!['dig', 'place'].includes(operation) || !point(position) || typeof dimension !== 'string') throw new Error("Protection audit: operation dig/place, dimension, position.");
    const p = cell(position);
    for (const r of this.#regions.values()) if (r.dimension === dimension && ['x', 'y', 'z'].every(k => p[k] >= r.min[k] && p[k] <= r.max[k])) return { allowed: false, reason: `Protected region ${r.id}.`, regionId: r.id };
    if (operation !== 'dig' || !this.structures) return { allowed: true, reason: "Change permitted by policy." };
    block ??= getBlock?.(p);
    const own = this.#own.get(key(dimension, p));
    if (own && own.name === name(block) && (own.stateId === undefined || own.stateId === block?.stateId)) return { allowed: true, reason: "Self-confirmed block." };
    if (isStructureBlock(block)) return { allowed: false, reason: "Construction or functional unit.", evidence: p };
    if(name(block)==='nether_wart'&&Number(block.getProperties?.().age)===3)return {allowed:true,reason:"Collecting mature hell without destroying the building."};
    const matureFood={wheat:7,carrots:7,potatoes:7,beetroots:3}[name(block)];
    if(matureFood!==undefined&&Number(block.getProperties?.().age)>=matureFood)return {allowed:true,reason:'Harvesting mature food leaves the structural blocks and farmland intact.'};
    if (getBlock) for (let r = 1; r <= this.structureRadius; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      const q = { x: p.x + x, y: p.y + y, z: p.z + z };
      const neighbor=getBlock(q),knownOwn=this.#own.get(key(dimension,q));
      // An agent's confirmed workstation must not make its entire mine
      // untouchable. Foreign or changed structural anchors remain protected.
      // Lighting and inventory-driven station states do not change ownership.
      const ownStation=knownOwn&&/^(crafting_table|furnace|smoker|blast_furnace|smithing_table|brewing_stand)$/.test(name(neighbor))&&knownOwn.name===name(neighbor);
      if (isStructureBlock(neighbor)&&!ownStation) return { allowed: false, reason: "There's a building nearby; Production prohibited.", evidence: q };
    }
    return { allowed: true, reason: "No signs of construction found." };
  }
}

export const editDecision = (c, operation, position) => c.protection?.check({ operation, position,
  dimension: c.state.dimension ?? c.world.dimension ?? 'minecraft:overworld', block: c.world.blockAt(position), getBlock: p => c.world.blockAt(p) }) ?? { allowed: true };

export function assertEdit(c, operation, position) {
  const decision = editDecision(c, operation, position);
  if (!decision.allowed) {
    const error = new Error(`The block change is prohibited: ${decision.reason}`); error.code = 'KUDO_PROTECTED';
    c.emit?.('protectedEdit', { operation, position: { ...position }, ...decision }); throw error;
  }
}

export const rememberPlacement = (c, position) => {
  const dimension=c.state.dimension??c.world.dimension??'minecraft:overworld',block=c.world.blockAt(position);
  c.protection?.remember(dimension,position,block);
  if(block)c.emit?.('placementConfirmed',{dimension,position:{...cell(position)},name:name(block),stateId:block.stateId,serverConfirmed:true});
};
