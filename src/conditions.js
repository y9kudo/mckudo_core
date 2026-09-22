function factAt(observation, pointer) {
  let value = observation;
  for (const part of pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (['__proto__', 'constructor', 'prototype'].includes(part) || value == null || typeof value !== 'object' || !Object.hasOwn(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}
export function matches(condition, observation) {
  if (!condition) return true;
  if (condition.all) return condition.all.every(c => matches(c, observation));
  if (condition.any) return condition.any.some(c => matches(c, observation));
  if (condition.not) return !matches(condition.not, observation);
  const { found, value } = factAt(observation, condition.fact);
  if (Object.hasOwn(condition, 'exists')) return found === condition.exists;
  if (!found) return false;
  if (Object.hasOwn(condition, 'eq')) return value === condition.eq;
  if (Object.hasOwn(condition, 'ne')) return value !== condition.ne;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (Object.hasOwn(condition, 'lt')) return value < condition.lt;
  if (Object.hasOwn(condition, 'lte')) return value <= condition.lte;
  if (Object.hasOwn(condition, 'gt')) return value > condition.gt;
  return value >= condition.gte;
}
