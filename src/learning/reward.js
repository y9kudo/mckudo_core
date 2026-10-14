import {finite, integer} from './contracts.js';

/** Pure per-transition reward. A potential must be Markovian; terminal potential is zero. */
export function createRewardAPI({ terms = {}, potential, gamma = .99, clip = 100 } = {}) {
  finite(gamma, 0, 1, 'gamma'); finite(clip, .001, 1e6, 'clip');
  if (!terms || typeof terms !== 'object' || Object.keys(terms).length > 64 || Object.values(terms).some(f => typeof f !== 'function') || potential !== undefined && typeof potential !== 'function') throw new TypeError('Reward terms/potential must be functions');
  return { evaluate(transition) {
    const parts = Object.create(null);
    for (const [id, term] of Object.entries(terms)) parts[id] = finite(term(transition), -1e9, 1e9, `reward.${id}`);
    if (potential) parts.shaping = gamma * (transition.terminated ? 0 : finite(potential(transition.nextObservation), -1e9, 1e9, 'next potential')) - finite(potential(transition.observation), -1e9, 1e9, 'potential');
    return { reward: Math.max(-clip, Math.min(clip, Object.values(parts).reduce((a,b) => a+b, 0))), parts: {...parts} };
  } };
}

/** Bounded episodic count bonus; explicitly not RND or a learned curiosity model. */
export function createNoveltyBonus({ capacity = 4096, scale = .05 } = {}) {
  integer(capacity, 1, 100000, 'capacity'); finite(scale, 0, 100, 'scale'); const counts = new Map();
  return { visit(key) { if (typeof key !== 'string' || key.length > 512) throw new TypeError('Novelty key'); const n=(counts.get(key)||0)+1; counts.delete(key); counts.set(key,n); if(counts.size>capacity) counts.delete(counts.keys().next().value); return scale/Math.sqrt(n); }, reset() { counts.clear(); }, snapshot: () => ({ entries: counts.size, capacity }) };
}
