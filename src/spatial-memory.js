import { jsonCopy } from './config.js';

const resource = value => typeof value === 'string' && /^[a-z0-9_.-]+:[a-z0-9_./-]{1,128}$/.test(value);
const point = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);
const key = (dimension, p) => `${dimension}/${p.x}/${p.y}/${p.z}`;
const empty = name => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(name);
const blockName = block => { const name = block?.name ?? block?.id; return typeof name === 'string' ? name.includes(':') ? name : 'minecraft:' + name : null; };

/** Last-observed landmarks, not a source of authoritative collision or inventory facts. */
export function createSpatialMemory({ worldId, maxEntries = 2048, maxAgeMs = 7 * 86400000, memory, clock = Date.now } = {}) {
  if (typeof worldId !== 'string' || !worldId || worldId.length > 128 || !Number.isInteger(maxEntries) || maxEntries < 16 || maxEntries > 4096 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 30 * 86400000) throw new Error('Пространственная память: worldId, maxEntries 16–4096, maxAgeMs 1 с–30 суток.');
  const records = new Map(); let invalidations = 0;
  if (typeof clock !== 'function') throw new Error('clock должен быть функцией.');
  const stamp = () => { const now = clock(); if (!Number.isSafeInteger(now) || now < 0) throw new Error('clock должен вернуть целое время Unix в миллисекундах.'); return now; };
  const trim = () => {
    const now = stamp();
    for (const [id, entry] of records) if (now - entry.lastSeen > maxAgeMs) records.delete(id);
    while (records.size > maxEntries) records.delete(records.keys().next().value);
  };
  if (memory !== undefined) {
    const m = jsonCopy(memory, 'spatialMemory', 1024 * 1024);
    if (m.schemaVersion !== 1 || m.worldId !== worldId || !Array.isArray(m.entries) || m.entries.length > 4096) throw new Error('Пространственная память другого мира или формата.');
    for (const e of m.entries) {
      if (!resource(e.dimension) || !resource(e.name) || empty(e.name) || !point(e.position) || !Number.isSafeInteger(e.lastSeen) || e.lastSeen < 0 || !Number.isSafeInteger(e.observations) || e.observations < 1) throw new Error('Повреждена запись пространственной памяти.');
      const id = key(e.dimension, e.position); if (records.has(id)) throw new Error('Повтор координат в пространственной памяти.');
      records.set(id, { name: e.name, position: { ...e.position }, dimension: e.dimension, lastSeen: e.lastSeen, observations: e.observations });
    }
    const ordered = [...records].sort((a, b) => a[1].lastSeen - b[1].lastSeen); records.clear(); for (const [id, e] of ordered) records.set(id, e); trim();
  }
  return {
    worldId,
    observe(observation, { getBlock } = {}) {
      const dimension = observation.dimension;
      if (!resource(dimension)) throw new Error('Нужен namespaced ID измерения.');
      if (getBlock !== undefined && typeof getBlock !== 'function') throw new Error('getBlock должен быть функцией.');
      const blocks = observation.world?.sampledBlocks || [];
      if (!Array.isArray(blocks) || blocks.length > 4096 || blocks.some(b => !resource(b.name) || !point(b.position))) throw new Error('Нужны наблюдаемые блоки с ID и целыми координатами.');
      trim();
      // Unknown chunks preserve a hint; visible contradictory blocks revoke it.
      if (getBlock) for (const [id, e] of records) if (e.dimension === dimension) {
        const actual = blockName(getBlock(e.position));
        if (actual && actual !== e.name) { records.delete(id); invalidations++; }
      }
      const now = stamp(); let added = 0;
      for (const b of blocks) {
        const id = key(dimension, b.position), old = records.get(id);
        const actual = blockName(getBlock?.(b.position));
        if (actual && actual !== b.name) continue;
        records.delete(id);
        if (empty(b.name)) { if (old) invalidations++; continue; }
        records.set(id, { name: b.name, position: { ...b.position }, dimension, lastSeen: now, observations: Math.min(Number.MAX_SAFE_INTEGER, (old?.name === b.name ? old.observations : 0) + 1) }); added++;
      }
      trim(); return added;
    },
    entries({ dimension, names, near, limit = maxEntries } = {}) {
      if (dimension !== undefined && !resource(dimension) || names !== undefined && (!Array.isArray(names) || names.length > 4096 || names.some(n => !resource(n))) || near !== undefined && !point(near) || !Number.isInteger(limit) || limit < 1 || limit > maxEntries) throw new Error('Неверный запрос пространственной памяти.');
      trim(); const ids = names && new Set(names);
      const found = [...records.values()].filter(e => (!dimension || e.dimension === dimension) && (!ids || ids.has(e.name)));
      found.sort((a, b) => near ? Math.hypot(a.position.x-near.x,a.position.y-near.y,a.position.z-near.z) - Math.hypot(b.position.x-near.x,b.position.y-near.y,b.position.z-near.z) || b.lastSeen-a.lastSeen : b.lastSeen-a.lastSeen);
      return structuredClone(found.slice(0, limit));
    },
    snapshot() { trim(); return { worldId, entries: records.size, maxEntries, maxAgeMs, invalidations, dimensions: [...new Set([...records.values()].map(e => e.dimension))] }; },
    export() { trim(); return jsonCopy({ schemaVersion: 1, worldId, entries: [...records.values()] }, 'spatialMemory', 1024 * 1024); }
  };
}
