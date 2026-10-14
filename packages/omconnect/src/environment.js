const name = b => (b?.name || b?.id || '').replace(/^minecraft:/, '');
const props = b => b?.getProperties?.() || b?.properties || {};
const aquatic = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
export function fluidAt(block) {
  const n = name(block), p = props(block), kind = n === 'lava' ? 'lava' : aquatic.has(n) || p.waterlogged === true ? 'water' : null;
  const level = Number(p.level ?? 0);
  return kind ? { kind, height: 1 - ((level >= 8 ? 0 : level) + 1) / 9, level, falling: level >= 8 } : null;
}
export function environmentAt(position, getBlock) {
  const min = { x: Math.floor(position.x - .299), y: Math.floor(position.y + .001), z: Math.floor(position.z - .299) }, max = { x: Math.floor(position.x + .299), y: Math.floor(position.y + 1.799), z: Math.floor(position.z + .299) };
  const contacts = [], fluids = []; let unknown = false;
  for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) for (let x = min.x; x <= max.x; x++) {
    const p = { x, y, z }, b = getBlock(p); if (!b) { unknown = true; continue; }
    const n = name(b); contacts.push(n); const f = fluidAt(b);
    if (f && position.y + .001 < y + (fluidAt(getBlock({ x, y: y + 1, z }))?.kind === f.kind ? 1 : f.height)) fluids.push({ ...f, position: p });
  }
  const kind = fluids.some(f => f.kind === 'lava') ? 'lava' : fluids.length ? 'water' : 'air', flow = { x: 0, y: 0, z: 0 };
  for (const f of fluids.filter(f => f.kind === kind)) {
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = getBlock({ x: f.position.x + x, y: f.position.y, z: f.position.z + z }), other = fluidAt(b);
      if (other?.kind === kind) { const slope = f.height - other.height; flow.x += x * slope; flow.z += z * slope; }
    }
    if (f.falling) flow.y -= 6;
  }
  const length = Math.hypot(flow.x, flow.y, flow.z); if (length) for (const axis of ['x', 'y', 'z']) flow[axis] /= length;
  const support = name(getBlock({ x: Math.floor(position.x), y: Math.floor(position.y - .05), z: Math.floor(position.z) }));
  return { medium: kind, contacts: [...new Set(contacts)], support, flow, unknown, hazardous: kind === 'lava' || contacts.some(n => ['fire', 'soul_fire', 'cactus', 'sweet_berry_bush', 'wither_rose', 'powder_snow'].includes(n)), slipperiness: ({ ice: .98, packed_ice: .98, frosted_ice: .98, blue_ice: .989, slime_block: .8 })[support] || .6 };
}
