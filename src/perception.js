import { jsonCopy, object } from './config.js';

const position = p => p === null || (object(p) && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])));
// Unknown values remain null. An omitted item count is not silently turned into zero.
export function normalizeObservation(input) {
  const o = jsonCopy(input);
  if (!object(o) || (o.perceptionVersion !== undefined && o.perceptionVersion !== 1)) throw new Error("perceptionVersion must be 1.");
  for (const key of ['self', 'inventory', 'world', 'time']) if (o[key] !== undefined && !object(o[key])) throw new Error(`perception.${key}: an object is required.`);
  o.perceptionVersion = 1;
  o.self = { health: null, food: null, position: null, ...o.self };
  o.inventory ??= {};
  o.world = { dimension: o.dimension ?? null, ...o.world };
  o.time = { timeOfDay: null, isDay: null, ...o.time };
  o.entities ??= null;
  for (const key of ['health', 'food']) if (o.self[key] !== null && (!Number.isFinite(o.self[key]) || o.self[key] < 0)) throw new Error(`perception.self.${key}: need an unnegative number or null.`);
  if (!position(o.self.position)) throw new Error("perception.self.position: requires x, y, z or null.");
  if (o.world.dimension !== null && typeof o.world.dimension !== 'string') throw new Error("perception.world.dimension: row or null.");
  if (o.dimension !== undefined && o.dimension !== o.world.dimension) throw new Error("dimension and world.dimension Not matching.");
  o.dimension = o.world.dimension; // Compatibility alias for rules written before perception v1.
  for (const [name, count] of Object.entries(o.inventory)) {
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(name) || !Number.isSafeInteger(count) || count < 0) throw new Error(`perception.inventory.${name}: requires namespace:id And the whole number >= 0.`);
  }
  if (o.time.timeOfDay !== null && (!Number.isInteger(o.time.timeOfDay) || o.time.timeOfDay < 0 || o.time.timeOfDay >= 24000)) throw new Error("perception.time.timeOfDay: 0–23999 or null.");
  if (o.time.isDay !== null && typeof o.time.isDay !== 'boolean') throw new Error("perception.time.isDay: boolean or null.");
  if (o.entities !== null) {
    if (!Array.isArray(o.entities) || o.entities.length > 128) throw new Error("perception.entities: to 128 entities or null.");
    for (const e of o.entities) if (!object(e) || typeof e.id !== 'string' || typeof e.name !== 'string' || !position(e.position)) throw new Error("perception.entities: requires id, name and position.");
  }
  return jsonCopy(o);
}
