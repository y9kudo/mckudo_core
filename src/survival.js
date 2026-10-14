import { matches } from './conditions.js';
import { jsonCopy, id, validateCondition } from './config.js';
const has = (item, count = 1) => ({ fact: `/inventory/minecraft:${item}`, gte: count });
export const survivalStages = () => [
  { id: 'wood', desired: has('crafting_table'), description: "Prepare the Versac." },
  { id: 'wooden-tools', desired: has('wooden_pickaxe'), description: "Get a wooden pick." },
  { id: 'stone-tools', desired: { all: [has('stone_pickaxe'), has('furnace')] }, description: "Go to the rock and prepare the furnace." },
  { id: 'iron-tools', desired: has('iron_pickaxe'), description: "Get the iron pick." }
];
export function createSurvivalProgression({ stages = survivalStages(), completed = [] } = {}) {
  const definitions = jsonCopy(stages), done = new Set(completed);
  if (!definitions.length || definitions.length > 32 || new Set(definitions.map(s => s.id)).size !== definitions.length) throw new Error("Requires 1–32 The unique phases.");
  for (const s of definitions) { if (!id(s.id)) throw new Error("Wrong phase."); validateCondition(s.desired, `stages.${s.id}`); }
  if ([...done].some(n => !definitions.some(s => s.id === n))) throw new Error("Saved Unknown Phase.");
  return {
    update(observation) {
      for (const stage of definitions) {
        if (done.has(stage.id)) continue;
        if (!matches(stage.desired, observation)) break;
        done.add(stage.id);
      }
      const next = definitions.find(s => !done.has(s.id));
      return { completed: [...done], current: next ? jsonCopy(next) : null, status: next ? 'progressing' : 'completed' };
    },
    exportMemory: () => ({ completed: [...done] })
  };
}

export function createDefenseReactor({ attackPlayers = false, retaliationHits = 2, retaliationWindowMs = 10000, retreatHealth = 8, dangerRadius = 8, maxChaseDistance = 12, trustedPlayers = [], clock = Date.now } = {}) {
  if (typeof attackPlayers !== 'boolean' || !Number.isInteger(retaliationHits) || retaliationHits < 1 || retaliationHits > 10 || ![retaliationWindowMs, retreatHealth, dangerRadius, maxChaseDistance].every(n => Number.isFinite(n) && n > 0) || maxChaseDistance > 32 || dangerRadius > maxChaseDistance || !Array.isArray(trustedPlayers) || trustedPlayers.some(n => typeof n !== 'string')) throw new Error("Wrong protection policy.");
  const trusted = new Set(trustedPlayers.map(n => n.toLowerCase()));
  const recentHits = a => Array.isArray(a.hitTimes) ? a.hitTimes.filter(t => clock() - t >= 0 && clock() - t <= retaliationWindowMs).length : a.hits;
  return { id: 'overmind:defense', apiVersion: 1, preempt: true,
    react(observation) {
      const p = observation.self?.position;
      if (!p || !Array.isArray(observation.entities)) return { action: null, reason: "Not enough observations to assess threats." };
      const threats = observation.entities.map(e => ({ ...e, distance: e.position ? Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) : Infinity }))
        .filter(e => e.distance <= maxChaseDistance && (e.kind !== 'player' && e.hostile === true && e.visible !== false && e.distance <= dangerRadius || (e.kind !== 'player' || attackPlayers && !trusted.has(e.username?.toLowerCase())) &&
          (observation.combat?.attackers || []).some(a => a.entityId === e.id && recentHits(a) >= (e.kind === 'player' ? retaliationHits : 1) && clock() - a.lastHitAt >= 0 && clock() - a.lastHitAt <= retaliationWindowMs)))
        .sort((a, b) => a.distance - b.distance);
      const target = threats[0];
      if (!target) return { action: null, reason: "No confirmed threats." };
      const retreat = observation.self.health == null || observation.self.health <= retreatHealth || target.name === 'creeper';
      return { priority: 1000, action: { skill: retreat ? 'flee' : 'attack', args: { entityId: target.id, maxDistance: maxChaseDistance } },
        reason: retreat ? "Retreat from the threat." : target.kind === 'player' ? "Response to confirmed attack by a player." : "Protection against hostile bub." };
    }
  };
}
