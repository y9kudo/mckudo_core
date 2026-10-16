const shortName = b => String(b?.name || b?.id || 'unknown').replace(/^minecraft:/, '');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Small geometry summaries shared by learning and frontier ranking, not a collision authority. */
export function createNavigationContextReader({ client, atlas, maxEntries = 1024 } = {}) {
  if (!client?.world || typeof client.world.blockAt !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 16 || maxEntries > 4096) throw new Error('Navigation context needs a client and a cache budget 16–4096.');
  const cache = new Map(); let dimension, revision, reads = 0, hits = 0;
  const geometry = to => {
    const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(to[k])]));
    const d = client.state.dimension, r = client.world.revision;
    if (d !== dimension || r !== revision) { cache.clear(); dimension = d; revision = r; }
    const id = `${p.x},${p.y},${p.z}`;
    if (cache.has(id)) { hits++; return cache.get(id); }
    const positions = [{ ...p, y: p.y - 1 }, p, { ...p, y: p.y + 1 }, { ...p, y: p.y + 2 },
      { ...p, x: p.x - 1 }, { ...p, x: p.x + 1 }, { ...p, z: p.z - 1 }, { ...p, z: p.z + 1 }];
    const blocks = positions.map(q => { reads++; return client.world.blockAt(q); });
    const names = blocks.map(shortName), support = names[0], occupied = b => b && b.boundingBox !== 'empty' && !['air', 'cave_air', 'void_air'].includes(shortName(b));
    // Include shapes/state in the fingerprint: a trapdoor or partial block can change without changing its name.
    const fingerprint = blocks.map(b => b ? `${shortName(b)}:${b.stateId ?? ''}:${JSON.stringify(b.shapes || [])}` : '?').join('|');
    let hash = 2166136261; for (let i = 0; i < fingerprint.length; i++) hash = Math.imul(hash ^ fingerprint.charCodeAt(i), 16777619);
    const result = { loaded: blocks.every(Boolean), signature: (hash >>> 0).toString(16),
      slipperiness: /^(?:ice|packed_ice|blue_ice)$/.test(support) ? .98 : support === 'slime_block' ? .8 : .6,
      headroom: occupied(blocks[2]) ? 1 : occupied(blocks[3]) ? 2 : 3,
      water: names.some(n => ['water', 'bubble_column'].includes(n)), lava: names.includes('lava'),
      slow: names.some(n => ['cobweb', 'honey_block', 'soul_sand', 'sweet_berry_bush', 'powder_snow'].includes(n)),
      hazards: names.filter(n => ['lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'powder_snow', 'sweet_berry_bush', 'wither_rose'].includes(n)).length };
    cache.set(id, result); if (cache.size > maxEntries) cache.delete(cache.keys().next().value); return result;
  };
  return {
    read(from, to, kind = 'walk') {
      if (![from, to].every(p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])))) throw new Error('Navigation context needs finite from/to.');
      const g = geometry(to), v = client.state.velocity || {}, floor = p => Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(p[k])]));
      const history = atlas?.transitionHistory({ dimension: client.state.dimension, from: floor(from), to: floor(to), kind });
      let hostiles = 0;
      for (const e of client.entities?.values() || []) if (e.kind === 'hostile' && e.position && Math.hypot(e.position.x - to.x, e.position.y - to.y, e.position.z - to.z) < 12) hostiles++;
      return { ...g, speed: clamp(Math.hypot(v.x || 0, v.y || 0, v.z || 0), 0, 4), fallHeight: Math.max(0, from.y - to.y), hostiles,
        historyFailureRate: history ? history.failures / Math.max(1, history.failures + history.successes) : 0,
        historyConfidence: history ? Math.min(1, (history.failures + history.successes) / 16) : 0 };
    },
    clear() { cache.clear(); },
    snapshot: () => ({ entries: cache.size, maxEntries, reads, hits })
  };
}
