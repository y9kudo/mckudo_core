import { createHash } from 'node:crypto';
import { jsonCopy, validateCondition, id } from './config.js';
import { factAt } from './conditions.js';
import { validateOperators } from './planner.js';
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const signature = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex').slice(0, 24);
const primitive = v => v === null || ['number', 'string', 'boolean'].includes(typeof v);

/** Grounded hypotheses from repeated action transitions, never a causal guarantee. */
export function createExperienceModel({ worldId, facts, contextFacts = ['/dimension'], minEvidence = 3, retryMs = 5000, clock = Date.now } = {}) {
  if (typeof worldId !== 'string' || !worldId || worldId.length > 128 || !Array.isArray(facts) || !facts.length || facts.length > 8 || !Array.isArray(contextFacts) || contextFacts.length > 8 || !Number.isInteger(minEvidence) || minEvidence < 2 || minEvidence > 100 || !Number.isInteger(retryMs) || retryMs < 100 || retryMs > 300000) throw new Error('Опыт: worldId, 1–8 facts, до 8 contextFacts, minEvidence 2–100.');
  for (const fact of [...facts, ...contextFacts]) validateCondition({ fact, exists: true }, 'experience.fact');
  facts = [...new Set(facts)]; contextFacts = [...new Set(contextFacts)];
  const records = new Map(), recent = new Map(), journal = []; let revision = 0;
  const project = (o, pointers) => pointers.map(fact => { const f = factAt(o, fact); return f.found && primitive(f.value) ? { fact, value: f.value } : null; });
  const keyFor = (action, before) => {
    const context = project(before, contextFacts);
    if (context.some(c => c === null)) return null;
    return { key: signature({ action, context }), context };
  };
  const record = input => {
    const sample = jsonCopy(input), { episodeId, action, before, after, outcome } = sample;
    if (typeof episodeId !== 'string' || !episodeId || episodeId.length > 160 || !action || !id(action.skill) || !['success', 'progress', 'failure', 'cancelled'].includes(outcome) || !before) throw new Error('Опыт: episodeId, action, before и outcome обязательны.');
    if (recent.has(episodeId) || outcome === 'cancelled') return false;
    const group = keyFor(action, before); if (!group) return false;
    const beforeFacts = project(before, facts), afterFacts = after ? project(after, facts) : [];
    if (outcome !== 'failure' && (beforeFacts.some(f => f === null) || afterFacts.length !== facts.length || afterFacts.some(f => f === null))) return false;
    recent.set(episodeId, true); if (recent.size > 2048) recent.delete(recent.keys().next().value);
    let r = records.get(group.key);
    if (!r) {
      if (records.size >= 256) records.delete(records.keys().next().value);
      r = { key: group.key, action, context: group.context, effects: [], requires: [], successes: 0, failures: 0, streak: 0, blockedUntil: 0, status: 'hypothesis', durationMs: null }; records.set(group.key, r);
    }
    const effects = outcome === 'failure' ? [] : facts.flatMap((fact, i) => {
      const a = beforeFacts[i].value, b = afterFacts[i].value;
      return a === b ? [] : [{ fact, ...(typeof a === 'number' && typeof b === 'number' ? { add: b - a } : { set: b }) }];
    });
    // Any unmodelled change/no-op revokes the prior prediction immediately.
    const consistent = effects.length > 0 && (!r.effects.length || signature(effects) === signature(r.effects));
    if (outcome === 'failure' || !consistent) {
      r.failures++; r.streak = 0; r.status = 'retracted'; r.blockedUntil = clock() + Math.min(300000, retryMs * 2 ** Math.min(r.failures - 1, 5));
      if (effects.length) { r.effects = effects; r.requires = []; }
    } else {
      r.effects = effects; r.successes++; r.streak++; r.blockedUntil = 0;
      // Numeric consumption is bounded. Context and categorical pre-values stay explicit.
      r.requires = [...r.context.map(c => ({ fact: c.fact, eq: c.value })), ...effects.map(e => Object.hasOwn(e, 'add') ? { fact: e.fact, gte: Math.max(0, -e.add) } : { fact: e.fact, eq: beforeFacts.find(f => f.fact === e.fact).value })];
      r.status = r.streak >= minEvidence ? 'usable' : 'hypothesis';
      if (Number.isFinite(sample.durationMs) && sample.durationMs >= 0) r.durationMs = r.durationMs === null ? sample.durationMs : 0.8 * r.durationMs + 0.2 * sample.durationMs;
    }
    revision++; journal.push({ revision, key: r.key, status: r.status, outcome, episodeId }); if (journal.length > 64) journal.shift(); return true;
  };
  return {
    worldId, record,
    assess(action, observation) { const g = keyFor(action, observation), r = g && records.get(g.key); return r ? { status: r.status, blocked: r.blockedUntil > clock(), failures: r.failures, durationMs: r.durationMs, confidence: (r.successes + 1) / (r.successes + r.failures + 2) } : { status: 'unknown', blocked: false, failures: 0, durationMs: null, confidence: 0 }; },
    operators() {
      return [...records.values()].filter(r => r.status === 'usable' && r.blockedUntil <= clock()).slice(-64).map(r => validateOperators([{ id: `learned:${r.key}`, action: r.action, requires: { all: r.requires }, effects: r.effects, cost: Math.min(1000, Math.max(1, Math.ceil((r.durationMs ?? 1000) / 1000))) }])[0]);
    },
    snapshot() { return jsonCopy({ worldId, revision, hypotheses: [...records.values()].map(r => ({ ...r, confidence: (r.successes + 1) / (r.successes + r.failures + 2) })), journal }, '$', 1048576); }
  };
}
