const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const cell = p => Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(p[k])]));
const key = (dimension, p) => `${dimension}/${p.x},${p.y},${p.z}`;
const name = block => (block?.name || block?.id || '').replace(/^minecraft:/, '');

// These are evidence of a structure, not proof of who built it. Natural structures
// are deliberately treated conservatively too. Logs, leaves and ores are not anchors.
export const isStructureBlock = block => /(?:_planks|_stairs|_slab|_door|_trapdoor|_fence|_fence_gate|_glass|_glass_pane|_bricks|_brick_wall|_bed|_sign|_hanging_sign|_terracotta|_concrete|_wool|_shulker_box)$/.test(name(block)) ||
  /^(?:cobblestone|cobbled_deepslate|stone_bricks|bricks|glass|glass_pane|terracotta|chest|trapped_chest|barrel|furnace|blast_furnace|smoker|crafting_table|smithing_table|brewing_stand|enchanting_table|bookshelf|chiseled_bookshelf|anvil|chipped_anvil|damaged_anvil|hopper|dispenser|dropper|observer|piston|sticky_piston|beacon|bell|lantern|soul_lantern)$/.test(name(block));

function region(input) {
  if (!input || typeof input.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(input.id) || typeof input.dimension !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(input.dimension) || !point(input.min) || !point(input.max)) throw new Error('Защищённая область: id, dimension и min/max {x,y,z}.');
  const a = cell(input.min), b = cell(input.max);
  return { id: input.id, dimension: input.dimension,
    min: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.min(a[k], b[k])])),
    max: Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.max(a[k], b[k])])) };
}

/** Client-side edit policy. Regions are exact; automatic structure detection is a heuristic. */
export class KudoProtection {
  #regions = new Map();
  #own = new Map();
  #revision = 0;
  constructor({ regions = [], structures = true, structureRadius = 2 } = {}) {
    if (!Array.isArray(regions) || regions.length > 128 || typeof structures !== 'boolean' || !Number.isInteger(structureRadius) || structureRadius < 0 || structureRadius > 3) throw new Error('Защита: до 128 областей, structures boolean, structureRadius 0–3.');
    this.structures = structures; this.structureRadius = structureRadius;
    for (const r of regions) { if (this.#regions.has(r?.id)) throw new Error('ID защищённых областей должны быть уникальными.'); this.add(r); }
  }
  get revision() { return this.#revision; }
  get regions() { return structuredClone([...this.#regions.values()]); }
  add(input) {
    const r = region(input);
    if (!this.#regions.has(r.id) && this.#regions.size >= 128) throw new Error('Достигнут лимит защищённых областей.');
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
  check({ operation, dimension, position, block, getBlock }) {
    if (!['dig', 'place'].includes(operation) || !point(position) || typeof dimension !== 'string') throw new Error('Проверка защиты: operation dig/place, dimension, position.');
    const p = cell(position);
    for (const r of this.#regions.values()) if (r.dimension === dimension && ['x', 'y', 'z'].every(k => p[k] >= r.min[k] && p[k] <= r.max[k])) return { allowed: false, reason: `Защищённая область ${r.id}.`, regionId: r.id };
    if (operation !== 'dig' || !this.structures) return { allowed: true, reason: 'Изменение разрешено политикой.' };
    block ??= getBlock?.(p);
    const own = this.#own.get(key(dimension, p));
    if (own && own.name === name(block) && (own.stateId === undefined || own.stateId === block?.stateId)) return { allowed: true, reason: 'Собственный подтверждённый блок.' };
    if (isStructureBlock(block)) return { allowed: false, reason: 'Строительный или функциональный блок.', evidence: p };
    if (getBlock) for (let r = 1; r <= this.structureRadius; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      const q = { x: p.x + x, y: p.y + y, z: p.z + z };
      if (isStructureBlock(getBlock(q))) return { allowed: false, reason: 'Рядом наблюдается постройка; добыча запрещена.', evidence: q };
    }
    return { allowed: true, reason: 'Признаки постройки не обнаружены.' };
  }
}

export const editDecision = (c, operation, position) => c.protection?.check({ operation, position,
  dimension: c.state.dimension ?? c.world.dimension ?? 'minecraft:overworld', block: c.world.blockAt(position), getBlock: p => c.world.blockAt(p) }) ?? { allowed: true };

export function assertEdit(c, operation, position) {
  const decision = editDecision(c, operation, position);
  if (!decision.allowed) {
    const error = new Error(`Изменение блока запрещено: ${decision.reason}`); error.code = 'KUDO_PROTECTED';
    c.emit?.('protectedEdit', { operation, position: { ...position }, ...decision }); throw error;
  }
}

export const rememberPlacement = (c, position) => c.protection?.remember(c.state.dimension ?? c.world.dimension ?? 'minecraft:overworld', position, c.world.blockAt(position));
