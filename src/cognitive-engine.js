import { createHash } from 'node:crypto';
import { jsonCopy, object } from './config.js';

const phases = new Set(['observe', 'understand', 'plan', 'act', 'verify', 'reflect', 'replan']);
const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 32);
const finite = n => Number.isFinite(n) && n >= 0;
const transient = new Set(['STALE_WORLD', 'SERVER_CORRECTION', 'OCCUPIED', 'SUPPORT_CHANGED', 'UNLOADED', 'DYNAMIC_OBSTACLE']);
const identity = c => JSON.stringify([c.kind, c.id, c.workflowId || '', c.stepId || '']);

/** One decision service shared by rules, reactors, workflows and symbolic goals. No executor. */
export function createCognitiveEngine({ worldId, assess, maxEntries = 256, maxAssessments = 64, journalSize = 64, commitmentMargin = .5, memory, clock = Date.now } = {}) {
  if (typeof worldId !== 'string' || !worldId.trim() || worldId.length > 128 || assess !== undefined && typeof assess !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 16 || maxEntries > 1024 || !Number.isInteger(maxAssessments) || maxAssessments < 1 || maxAssessments > 128 || !Number.isInteger(journalSize) || journalSize < 8 || journalSize > 128 || !finite(commitmentMargin) || commitmentMargin > 10 || typeof clock !== 'function') throw new Error('Cognitive engine options are invalid.');
  const records = new Map(), journal = [];
  let phase = 'observe', revision = 0, ranks = 0, committed = null, lastRanking = [];
  const context = o => {
    const p = o.self?.position;
    return digest({ dimension: o.dimension ?? null,
      region: p ? ['x', 'y', 'z'].map(k => Number.isFinite(p[k]) ? Math.floor(p[k] / 8) : null) : null,
      health: o.self?.health == null ? null : Math.floor(o.self.health / 5), food: o.self?.food == null ? null : Math.floor(o.self.food / 5),
      inventory: Object.entries(o.inventory || {}).filter(([, n]) => Number.isFinite(n) && n > 0).sort(([a], [b]) => a.localeCompare(b)).slice(0, 128) });
  };
  const recordKey = (candidate, observation, knownContext) => digest({ candidate: identity(candidate), action: candidate.action ?? null, context: knownContext??context(observation) });
  const stamp = () => { const t = clock(); if (!Number.isSafeInteger(t) || t < 0) throw new Error('Cognitive engine clock must return Unix milliseconds.'); return t; };
  const note = (kind, detail) => { journal.push({ at: stamp(), phase, kind, ...detail }); if (journal.length > journalSize) journal.shift(); };
  if (memory !== undefined) {
    const m = jsonCopy(memory, 'cognitiveMemory', 1024 * 1024);
    if (m.schemaVersion !== 1 || m.kind !== 'cognitive-engine' || m.worldId !== worldId || !Array.isArray(m.records) || m.records.length > 1024 || !Number.isSafeInteger(m.revision) || m.revision < 0) throw new Error('Cognitive memory belongs to another world or schema.');
    for (const r of m.records) {
      if (typeof r.key !== 'string' || !/^[a-f0-9]{32}$/.test(r.key) || records.has(r.key) || !['successes', 'failures', 'timedSamples'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0 && r[k] <= 1000000000) || !finite(r.meanDurationMs) || r.meanDurationMs > 86400000 || !Number.isSafeInteger(r.lastSeen) || r.lastSeen < 0) throw new Error('Cognitive experience record is invalid.');
      records.set(r.key, r);
    }
    while (records.size > maxEntries) records.delete(records.keys().next().value); revision = m.revision;
  }
  return {
    worldId,
    phase(next, detail = {}) { if (!phases.has(next)) throw new Error('Unknown cognitive phase.'); phase = next; note('phase', { reason: String(detail.reason || '').slice(0, 250), ...(detail.id ? { id: String(detail.id).slice(0, 160) } : {}) }); },
    rank(observation, candidates) {
      if (!object(observation) || !Array.isArray(candidates) || candidates.length > 2048) throw new Error('Cognitive ranking requires an observation and at most 2048 candidates.');
      const eligible = candidates.filter(c => !c.blocked), highest = eligible.length ? Math.max(...eligible.map(c => c.priority)) : null;
      let assessed = 0; const currentContext = context(observation);
      const ranked = candidates.map((candidate, order) => {
        if (!candidate || typeof candidate.id !== 'string' || typeof candidate.kind !== 'string' || !Number.isInteger(candidate.priority) || candidate.priority < -1000 || candidate.priority > 1000) throw new Error('Cognitive candidate identity or priority is invalid.');
        let learned = 0, uncertainty = 1, error = null;
        if (!candidate.blocked && candidate.action && candidate.priority === highest && candidate.priority<900 && assess && assessed < maxAssessments) {
          assessed++;
          try {
            const estimate = assess(observation, candidate.action);
            if (!estimate || typeof estimate.trained!=='boolean' || !finite(estimate.cost) || estimate.cost > 1000 || estimate.uncertainty !== undefined && (!finite(estimate.uncertainty) || estimate.uncertainty > 1)) throw new Error('Invalid learned cost or uncertainty.');
            uncertainty = estimate.uncertainty ?? (estimate.trained ? 0 : 1);
            if (estimate.trained && uncertainty < .75) learned = estimate.cost;
          } catch (e) { error = String(e.message).slice(0, 160); }
        }
        const r = candidate.action && records.get(recordKey(candidate, observation,currentContext)), samples = (r?.successes || 0) + (r?.failures || 0);
        const failureCost = samples >= 3 ? r.failures / samples * 8 : 0;
        const timeCost = r?.timedSamples >= 2 ? Math.min(4, r.meanDurationMs / 5000) : 0;
        const retained = committed?.id === identity(candidate) && committed.context === currentContext;
        const estimatedCost = candidate.priority>=900?0:Math.max(0, learned + failureCost + timeCost - (retained ? commitmentMargin : 0));
        return { candidate, order, estimatedCost, explanation: { id: candidate.id, kind: candidate.kind, priority: candidate.priority, blocked: candidate.blocked || null, learnedCost: learned, failureCost, timeCost, uncertainty, retained, estimatedCost, ...(error ? { error } : {}) } };
      });
      ranked.sort((a, b) => Number(Boolean(a.candidate.blocked)) - Number(Boolean(b.candidate.blocked)) || b.candidate.priority - a.candidate.priority || a.estimatedCost - b.estimatedCost || a.order - b.order);
      ranks++; lastRanking = ranked.slice(0, 128).map(v => v.explanation);
      return ranked.map(v => v.candidate);
    },
    commit(candidate, observation) { committed = { id: identity(candidate), context: context(observation) }; note('selected', { id: candidate.id, skill: candidate.action.skill }); },
    record({ candidate, before, outcome, durationMs, verified = false, failureCode }) {
      if (!['success', 'failure', 'progress', 'cancelled'].includes(outcome)) throw new Error('Unknown cognitive action outcome.');
      if (outcome === 'cancelled' || transient.has(failureCode) || outcome === 'progress' && !verified) { note('ignored', { id: candidate.id, outcome, reason: 'Cancelled, transient or unverified progress.' }); return false; }
      const key = recordKey(candidate, before), r = records.get(key) || { key, successes: 0, failures: 0, timedSamples: 0, meanDurationMs: 0, lastSeen: 0 };
      const field = outcome === 'failure' ? 'failures' : 'successes'; r[field] = Math.min(1000000000, r[field] + 1);
      if (verified && outcome !== 'failure' && finite(durationMs) && durationMs <= 86400000) { r.timedSamples = Math.min(1000000000, r.timedSamples + 1); r.meanDurationMs += (durationMs - r.meanDurationMs) / r.timedSamples; }
      r.lastSeen = stamp(); records.delete(key); records.set(key, r); while (records.size > maxEntries) records.delete(records.keys().next().value);
      if (outcome === 'failure') committed = null;
      revision++; note('result', { id: candidate.id, outcome, verified }); return true;
    },
    snapshot: () => ({ worldId, phase, revision, ranks, records: records.size, maxEntries, maxAssessments, committed: committed?.id || null, ranking: structuredClone(lastRanking), journal: structuredClone(journal) }),
    export: () => jsonCopy({ schemaVersion: 1, kind: 'cognitive-engine', worldId, revision, records: [...records.values()] }, 'cognitiveMemory', 1024 * 1024)
  };
}
