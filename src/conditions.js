export function factAt(observation, pointer) {
  let value = observation;
  for (const part of pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (['__proto__', 'constructor', 'prototype'].includes(part) || value == null || typeof value !== 'object' || !Object.hasOwn(value, part)) return { found: false };
    value = value[part];
  }
  return { found: true, value };
}
// Bounded explanations expose facts and comparisons, not hidden model reasoning.
export function explainCondition(condition, observation) {
  const facts = [];
  const visit = c => {
    if (!c || facts.length >= 32) return;
    if (c.all || c.any) return (c.all || c.any).forEach(visit);
    if (c.not) return visit(c.not);
    const actual = factAt(observation, c.fact);
    const operator = Object.keys(c).find(k => k !== 'fact');
    const value = actual.found && (actual.value === null || ['number', 'boolean', 'string'].includes(typeof actual.value)) ? actual.value : null;
    facts.push({ fact: c.fact, found: actual.found, value: typeof value === 'string' ? value.slice(0, 120) : value,
      operator, expected: c[operator], matched: matches(c, observation) });
  };
  visit(condition);
  return { matched: matches(condition, observation), facts };
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
