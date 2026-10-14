import { jsonCopy, validateCondition, id as validId } from './config.js';
import { matches } from './conditions.js';

/** A goal-preserving declarative plan is revised; no generated JavaScript is executed. */
export function createAdaptiveScenario({ id = 'adaptive', desired, strategies, model, priority = 10, peer } = {}) {
  validateCondition(desired, 'adaptive.desired');
  if (!validId(id) || !Number.isInteger(priority) || priority < -1000 || priority > 1000 || !Array.isArray(strategies) || !strategies.length || strategies.length > 32) throw new Error("Adaptive: id, desired and 1–32 strategies.");
  strategies = jsonCopy(strategies); desired = jsonCopy(desired);
  const ids = new Set();
  for (const s of strategies) {
    if (!validId(s.id) || ids.has(s.id) || !validId(s.action?.skill) || s.resource !== undefined && !validId(s.resource)) throw new Error("Strategy: unique id, action.skill non-binding resource.");
    ids.add(s.id); if (s.when) validateCondition(s.when, `strategies.${s.id}.when`);
  }
  let current = null, revision = 0, lastResource = null, status = 'pending'; const journal = [];
  const revise = (next, reason) => { if (next !== current) { journal.push({ revision: ++revision, from: current, to: next, reason }); if (journal.length > 64) journal.shift(); current = next; } };
  const release = () => { if (lastResource && peer) peer.release(lastResource); lastResource = null; };
  const reactor = { id, apiVersion: 1, react(o) {
    if (matches(desired, o)) { release(); revise(null, "Goal confirmed by observation."); status = 'completed'; return { action: null, reason: "Goal confirmed by observation." }; }
    const eligible = strategies.filter(s => matches(s.when, o) && !model?.assess(s.action, o).blocked);
    let selected = null;
    for (const s of eligible) {
      if (peer && s.resource) {
        const owner = peer.owner(s.resource);
        if (owner && owner !== peer.id) continue;
        const ownLease = peer.snapshot().claims.find(c => c.resource === s.resource && c.from === peer.id && !c.release);
        if (lastResource !== s.resource) { release(); peer.claim(s.resource); lastResource = s.resource; }
        else if (!ownLease || ownLease.expiresAt - peer.clock() < 1000) peer.claim(s.resource);
        if (!peer.owns(s.resource)) break;
      }
      selected = s; break;
    }
    if (!selected) { if (!eligible.some(s => s.resource === lastResource)) release(); revise(null, "Waiting for conditions, recovery from the error or intentions of the neighbours."); status = 'blocked'; return { action: null, reason: journal.at(-1)?.reason || "Waiting for an accessible strategy." }; }
    if (lastResource && selected.resource !== lastResource) release();
    revise(selected.id, "Plan recalculated from observation and experience."); status = 'active';
    return { action: jsonCopy(selected.action), priority, reason: `Strategy ${selected.id}, editorial ${revision}.` };
  } };
  return { reactor, snapshot: () => jsonCopy({ status, revision, current, desired, journal }), dispose: release };
}
