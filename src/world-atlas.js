import { createSpatialMemory } from './spatial-memory.js';
import { jsonCopy } from './config.js';

const RESOURCE = /^[a-z0-9_.-]+:[a-z0-9_./-]{1,128}$/;
const point = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);
const cell = p => `${p.x},${p.y},${p.z}`;
const region = p => ({ x: Math.floor(p.x / 16), y: Math.floor(p.y / 16), z: Math.floor(p.z / 16) });
const key = (dimension, p) => `${dimension}/${cell(p)}`;
const nameOf = b => { const n = b?.name ?? b?.id; return typeof n === 'string' ? n.includes(':') ? n : `minecraft:${n}` : null; };
const hazard = n => /:(?:lava|fire|soul_fire|cactus|magma_block|powder_snow|sweet_berry_bush|wither_rose)$/.test(n);
const timestamp = n => Number.isSafeInteger(n) && n >= 0;
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
const bounded = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const transient = new Set(['STALE_WORLD', 'SERVER_CORRECTION', 'OCCUPIED', 'SUPPORT_CHANGED', 'UNLOADED', 'DYNAMIC_OBSTACLE']);
const sameScope = (a, b) => ['serverId', 'worldId', 'minecraftVersion'].every(k => a?.[k] === b?.[k]);

export function worldAtlasScope(client, worldId) {
  const options = client.options || {};
  const version=client.dataLoaded===false?options.version:client.registry?.version?.minecraftVersion||options.version;
  return { serverId: `${options.host || '127.0.0.1'}:${options.port || 25565}`, worldId,
    minecraftVersion: String(version || 'unknown') };
}

/** Evidence and return-route hints. This module never supplies collision blocks or executes actions. */
export function createWorldAtlas({ scope, landmarks, memory, store, maxRegions = 512, maxTransitions = 1024, maxAgeMs = 7 * 86400000, clock = Date.now } = {}) {
  if (!scope || ['serverId', 'worldId', 'minecraftVersion'].some(k => typeof scope[k] !== 'string' || !scope[k].trim() || scope[k].length > 128)) throw new Error('World atlas needs serverId, worldId and minecraftVersion.');
  scope = Object.fromEntries(['serverId', 'worldId', 'minecraftVersion'].map(k => [k, scope[k]]));
  if (!bounded(maxRegions, 16, 4096) || !bounded(maxTransitions, 16, 8192) || !bounded(maxAgeMs, 1000, 30 * 86400000) || typeof clock !== 'function') throw new Error('World atlas budgets are invalid.');
  if (store && (typeof store.writeAtlasRecords !== 'function' || typeof store.readAtlasRecords !== 'function' || !sameScope(store.scope, scope))) throw new Error('World atlas store has a different scope or API.');
  const stamp = () => { const t = clock(); if (!timestamp(t)) throw new Error('World atlas clock must return Unix milliseconds.'); return t; };
  const dimensionOK = d => { if (typeof d !== 'string' || !RESOURCE.test(d)) throw new Error('World atlas needs a namespaced dimension.'); };
  const regions = new Map(), transitions = new Map(), anchors = new Map(), edgeIndex = new Map(), dirty = new Map(), previousRegion = new Map();
  let revision = 0, invalidations = 0, flushes = 0, migrated = false;
  const stats = { observedBlocks: 0, recordedTransitions: 0, evicted: 0 };
  const importedMemory = memory === undefined ? undefined : jsonCopy(memory, 'worldAtlas', 4 * 1024 * 1024);
  const spatial = landmarks || createSpatialMemory({ worldId: scope.worldId, clock, memory: importedMemory?.schemaVersion === 1 ? importedMemory : importedMemory?.landmarks });
  if (spatial.worldId !== scope.worldId) throw new Error('Atlas landmarks belong to another world.');
  const queue = (kind, id, value) => { if (store) dirty.set(`${kind}/${id}`, { kind, key: id, dimension: value.dimension, value: structuredClone(value), observedAt: value.lastSeen }); };
  const edgeRegions = e => {
    const a = region({ x: Math.min(e.from.x, e.to.x) - 1, y: Math.min(e.from.y, e.to.y) - 1, z: Math.min(e.from.z, e.to.z) - 1 });
    const b = region({ x: Math.max(e.from.x, e.to.x) + 1, y: Math.max(e.from.y, e.to.y) + 2, z: Math.max(e.from.z, e.to.z) + 1 });
    const ids = [];
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) for (let z = a.z; z <= b.z; z++) ids.push(key(e.dimension, { x, y, z }));
    return ids;
  };
  const removeEdge = id => {
    const e = transitions.get(id); if (!e) return;
    for (const r of edgeRegions(e)) { const ids = edgeIndex.get(r); ids?.delete(id); if (!ids?.size) edgeIndex.delete(r); }
    transitions.delete(id);
  };
  const putEdge = (id, e) => {
    removeEdge(id); transitions.set(id, e);
    for (const r of edgeRegions(e)) { if (!edgeIndex.has(r)) edgeIndex.set(r, new Set()); edgeIndex.get(r).add(id); }
  };
  const trim = () => {
    const now = stamp();
    for (const [map, limit] of [[regions, maxRegions], [transitions, maxTransitions], [anchors, 64]]) {
      for (const [id, e] of map) if (now - e.lastSeen > maxAgeMs) { if (map === transitions) removeEdge(id); else map.delete(id); if(map===regions&&previousRegion.get(e.dimension)===id)previousRegion.delete(e.dimension);stats.evicted++; revision++; }
      while (map.size > limit) { const id = map.keys().next().value; if (map === transitions) removeEdge(id); else map.delete(id); stats.evicted++; revision++; }
    }
    // Dirty records are bounded by the same live evidence budget, including invalidation tombstones.
    while (dirty.size > maxRegions + maxTransitions + 64) dirty.delete(dirty.keys().next().value);
  };
  const touchRegion = (dimension, p, time) => {
    const position = region(p), id = key(dimension, position);
    let r = regions.get(id);
    if (!r) { r = { dimension, position, cells: [], hazards: [], visits: 0, firstSeen: time, lastSeen: time }; revision++; }
    regions.delete(id); r.lastSeen = time; regions.set(id, r); return [id, r];
  };
  const validateRecord = (kind, value) => {
    const e = structuredClone(value);
    dimensionOK(e?.dimension);
    if (!timestamp(e.lastSeen) || e.lastSeen > stamp() + 60000) throw new Error('Atlas record timestamp is invalid.');
    if (kind === 'region') {
      if (!point(e.position) || ['x', 'y', 'z'].some(k => Math.abs(e.position[k]) > 1875001) || !Array.isArray(e.cells) || e.cells.length > 256 || new Set(e.cells).size !== e.cells.length || e.cells.some(v => !bounded(v, 0, 4095)) || !Array.isArray(e.hazards) || e.hazards.length > 64 || new Set(e.hazards).size !== e.hazards.length || e.hazards.some(v => !bounded(v, 0, 4095)) || !count(e.visits) || !timestamp(e.firstSeen) || e.firstSeen > e.lastSeen) throw new Error('Atlas region is invalid.');
      return [key(e.dimension, e.position), e];
    }
    if (kind === 'transition') {
      if (!point(e.from) || !point(e.to) || Math.hypot(e.from.x - e.to.x, e.from.y - e.to.y, e.from.z - e.to.z) > 96 || !['walk', 'jump', 'drop', 'bridge', 'swim', 'climb', 'fly', 'pillar'].includes(e.kind) || !count(e.successes) || !count(e.failures) || typeof e.valid !== 'boolean' || !Number.isFinite(e.damage) || e.damage < 0 || e.damage > 2048 || !count(e.timedSamples) || !Number.isFinite(e.meanTimeMs) || e.meanTimeMs < 0 || e.meanTimeMs > 120000) throw new Error('Atlas transition is invalid.');
      return [`${key(e.dimension, e.from)}>${cell(e.to)}/${e.kind}`, e];
    }
    if (kind === 'anchor') {
      if (typeof e.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(e.id) || !point(e.position) || !['base', 'portal', 'safe', 'resource', 'hazard'].includes(e.kind)) throw new Error('Atlas anchor is invalid.');
      return [`${e.dimension}/${e.id}`, e];
    }
    throw new Error('Unknown atlas record kind.');
  };
  const install = (kind, value, save = false) => {
    const [id, e] = validateRecord(kind, value), map = kind === 'region' ? regions : kind === 'transition' ? transitions : anchors;
    const old=map.get(id);
    if (old?.lastSeen > e.lastSeen || old?.lastSeen===e.lastSeen&&!(kind==='transition'&&old.valid&&!e.valid)) return;
    if (kind === 'transition') putEdge(id, e); else map.set(id, e);
    if (save) queue(kind, id, e); revision++;
  };
  if (memory !== undefined) {
    const m = importedMemory;
    if (m.schemaVersion === 1 && m.worldId === scope.worldId && Array.isArray(m.entries)) {
      // Legacy landmarks remain hints, with their original timestamps and dimensions.
      createSpatialMemory({ worldId: scope.worldId, memory: m, clock });
      migrated = true;
    } else {
      if (m.schemaVersion !== 2 || m.kind !== 'world-atlas' || !sameScope(m.scope, scope) || !Array.isArray(m.regions) || m.regions.length > 4096 || !Array.isArray(m.transitions) || m.transitions.length > 8192 || !Array.isArray(m.anchors) || m.anchors.length > 64) throw new Error('World atlas memory belongs to another scope or schema.');
      for (const [kind, list] of [['region', m.regions], ['transition', m.transitions], ['anchor', m.anchors]]) {
        const ids = new Set();
        for (const e of list) { const [id] = validateRecord(kind, e); if (ids.has(id)) throw new Error('Duplicate atlas evidence.'); ids.add(id); install(kind, e); }
      }
    }
    trim();
  }
  const api = {
    scope: Object.freeze({ ...scope }), worldId: scope.worldId, landmarks: spatial,
    observe(observation, { getBlock } = {}) {
      dimensionOK(observation.dimension);
      const blocks = observation.world?.sampledBlocks || [], dimension = observation.dimension, now = stamp();
      // Legacy memory performs complete input validation before the new evidence is changed.
      spatial.observe(observation, { getBlock }); trim();
      const touched = new Map();
      for (const b of blocks) {
        const actual = nameOf(getBlock?.(b.position)); if (actual && actual !== b.name) continue;
        const [id, r] = touchRegion(dimension, b.position, now), p = b.position;
        const local = ((p.y % 16 + 16) % 16) * 256 + ((p.z % 16 + 16) % 16) * 16 + (p.x % 16 + 16) % 16;
        if (!r.cells.includes(local) && r.cells.length < 256) { r.cells.push(local); revision++; }
        const i = r.hazards.indexOf(local);
        if (hazard(b.name) && i < 0 && r.hazards.length < 64) { r.hazards.push(local); revision++; }
        else if (!hazard(b.name) && i >= 0) { r.hazards.splice(i, 1); revision++; }
        touched.set(id, r); stats.observedBlocks++;
      }
      const p = observation.self?.position;
      if (p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) < 30000000)) {
        const [id, r] = touchRegion(dimension, p, now);
        if (previousRegion.get(dimension) !== id) { r.visits = Math.min(1000000000, r.visits + 1); revision++; previousRegion.set(dimension, id);if(previousRegion.size>64)previousRegion.delete(previousRegion.keys().next().value); }
        touched.set(id, r);
      }
      for (const [id, r] of touched) queue('region', id, r);
      trim(); return blocks.length;
    },
    invalidate({ dimension, position }) {
      dimensionOK(dimension); if (!point(position)) throw new Error('Atlas invalidation needs a block position.');
      const now = stamp(); let changed = 0;
      for (const id of edgeIndex.get(key(dimension, region(position))) || []) {
        const e = transitions.get(id);
        if (!e.valid || ['x', 'z'].some(k => position[k] < Math.min(e.from[k], e.to[k]) - 1 || position[k] > Math.max(e.from[k], e.to[k]) + 1) || position.y < Math.min(e.from.y, e.to.y) - 1 || position.y > Math.max(e.from.y, e.to.y) + 2) continue;
        e.valid = false; e.lastSeen = Math.max(now,e.lastSeen+1); queue('transition', id, e); changed++;
      }
      if (changed) { revision++; invalidations += changed; }
      return changed;
    },
    recordTransition(event) {
      if (event.outcome === 'cancelled' || transient.has(event.failureCode)) return false;
      if (!['success', 'failure'].includes(event.outcome)) throw new Error('Atlas transition outcome is invalid.');
      dimensionOK(event.dimension);
      if (!event.from || !event.to || !['x', 'y', 'z'].every(k => Number.isFinite(event.from[k]) && Number.isFinite(event.to[k]))) throw new Error('Atlas transition needs from/to.');
      const from = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(event.from[k])])), to = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(event.to[k])]));
      if (cell(from) === cell(to) || Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) > 96) return false;
      const now = stamp(), id = `${key(event.dimension, from)}>${cell(to)}/${event.kind || 'walk'}`;
      const e = transitions.get(id) || { dimension: event.dimension, from, to, kind: event.kind || 'walk', successes: 0, failures: 0, damage: 0, timedSamples: 0, meanTimeMs: 0 };
      const next = { ...e, valid: event.outcome === 'success', lastSeen: Math.max(now,(e.lastSeen??-1)+1) };
      next[event.outcome === 'success' ? 'successes' : 'failures'] = Math.min(1000000000, next[event.outcome === 'success' ? 'successes' : 'failures'] + 1);
      if (Number.isFinite(event.health) && Number.isFinite(event.healthAfter)) next.damage = Math.min(2048, Math.max(e.damage, event.health - event.healthAfter));
      if (event.outcome === 'success' && !event.timingEstimated && Number.isFinite(event.durationMs) && event.durationMs > 0 && event.durationMs <= 120000) { next.timedSamples = Math.min(1000000000, e.timedSamples + 1); next.meanTimeMs += (event.durationMs - e.meanTimeMs) / next.timedSamples; }
      validateRecord('transition', next); putEdge(id, next); queue('transition', id, next); revision++; stats.recordedTransitions++; trim(); return true;
    },
    markAnchor({ id, position, dimension, kind = 'safe' }) {
      const e = { id, position: { ...position }, dimension, kind, lastSeen: stamp() }, [k] = validateRecord('anchor', e);
      anchors.delete(k); anchors.set(k, e); queue('anchor', k, e); revision++; trim();
    },
    regionAt({ dimension, position }) {
      dimensionOK(dimension); if (!point(position)) throw new Error('Atlas region query needs an integer position.'); trim();
      const r = regions.get(key(dimension, region(position)));
      return r ? { ...structuredClone(r), observedFractionLowerBound: r.cells.length / 4096, requiresRevalidation: true } : null;
    },
    explorationCost({ dimension, position }) {
      const r = api.regionAt({ dimension, position });
      return r ? Math.min(30, Math.log2(1 + r.visits) * 2 + r.hazards.length * .5) : 0;
    },
    transitionHistory({ dimension, from, to, kind = 'walk' }) {
      dimensionOK(dimension); if (!point(from) || !point(to)) throw new Error('Atlas history needs integer from/to.'); trim();
      const e = transitions.get(`${key(dimension, from)}>${cell(to)}/${kind}`);
      return e ? { successes: e.successes, failures: e.failures, valid: e.valid, meanTimeMs: e.meanTimeMs, damage: e.damage, requiresRevalidation: true } : null;
    },
    returnCorridor({ dimension, from, to, maxEdges = 512, maxDamage = 0 }) {
      dimensionOK(dimension); if (!point(from) || !point(to) || !bounded(maxEdges, 1, 8192) || !Number.isFinite(maxDamage) || maxDamage < 0) throw new Error('Atlas corridor query is invalid.'); trim();
      const outgoing = new Map();
      for (const e of transitions.values()) if (e.dimension === dimension && e.valid && e.successes > 0 && e.damage <= maxDamage) { const k = cell(e.from); if (!outgoing.has(k)) outgoing.set(k, []); outgoing.get(k).push(e); }
      const queue = [{ p: from, path: [] }], seen = new Set([cell(from)]); let visited = 0;
      while (queue.length && visited < maxEdges) {
        const n = queue.shift(); visited++;
        if (cell(n.p) === cell(to)) return { status: 'hint', waypoints: [from, ...n.path.map(e => e.to)].map(p => ({ ...p })), transitions: structuredClone(n.path), visited, requiresRevalidation: true };
        for (const e of outgoing.get(cell(n.p)) || []) if (!seen.has(cell(e.to))) { seen.add(cell(e.to)); queue.push({ p: e.to, path: [...n.path, e] }); }
      }
      return { status: 'unavailable', waypoints: [], transitions: [], visited, requiresRevalidation: true };
    },
    flush({ limit = 64 } = {}) {
      if (!bounded(limit, 1, 256)) throw new Error('Atlas flush limit must be 1–256.');
      if (!store) return 0;
      const batch = [...dirty.entries()].slice(0, limit); if (!batch.length) return 0;
      store.writeAtlasRecords(batch.map(([, e]) => e)); for (const [id] of batch) dirty.delete(id); flushes++; return batch.length;
    },
    hydrate({ dimension, limit = 256 } = {}) {
      dimensionOK(dimension); if (!bounded(limit, 1, 4096)) throw new Error('Atlas hydration limit must be 1–4096.');
      if (!store) return 0;
      const records = store.readAtlasRecords({ dimension, limit, maxAgeMs });
      for (const record of records) install(record.kind, record.value); trim(); return records.length;
    },
    snapshot() { trim(); return { scope: { ...scope }, schemaVersion: 2, regions: regions.size, transitions: transitions.size, anchors: anchors.size, revision, invalidations, pendingWrites: dirty.size, flushes, migrated, ...stats, requiresRevalidation: true }; },
    export({ includeLandmarks = true } = {}) {
      trim(); return jsonCopy({ schemaVersion: 2, kind: 'world-atlas', scope, regions: [...regions.values()], transitions: [...transitions.values()], anchors: [...anchors.values()], ...(includeLandmarks ? { landmarks: spatial.export() } : {}) }, 'worldAtlas', 4 * 1024 * 1024);
    }
  };
  return api;
}

/** Observe the existing single executor; there is no second movement loop. */
export function attachWorldAtlas(client, atlas) {
  const block = e => { if(RESOURCE.test(client.state.dimension||''))atlas.invalidate({ dimension: client.state.dimension, position: e.position }); };
  const transition = e => { if(RESOURCE.test(e.dimension||''))atlas.recordTransition(e); };
  client.on('block', block); client.on('navigationStep', transition);
  return () => { client.off('block', block); client.off('navigationStep', transition); };
}
