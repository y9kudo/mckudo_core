import { matches } from './conditions.js';
import { jsonCopy, id, validateCondition } from './config.js';
const has = (item, count = 1) => ({ fact: `/inventory/minecraft:${item}`, gte: count });
export const survivalStages = () => [
  { id: 'wood', desired: has('crafting_table'), description: 'Подготовить верстак.' },
  { id: 'wooden-tools', desired: has('wooden_pickaxe'), description: 'Получить деревянную кирку.' },
  { id: 'stone-tools', desired: { all: [has('stone_pickaxe'), has('furnace')] }, description: 'Перейти к камню и подготовить печь.' },
  { id: 'iron-tools', desired: has('iron_pickaxe'), description: 'Получить железную кирку.' }
];
export function createSurvivalProgression({ stages = survivalStages(), completed = [] } = {}) {
  const definitions = jsonCopy(stages), done = new Set(completed);
  if (!definitions.length || definitions.length > 32 || new Set(definitions.map(s => s.id)).size !== definitions.length) throw new Error('Нужно 1–32 уникальных этапа.');
  for (const s of definitions) { if (!id(s.id)) throw new Error('Неверный этап.'); validateCondition(s.desired, `stages.${s.id}`); }
  if ([...done].some(n => !definitions.some(s => s.id === n))) throw new Error('Сохранён неизвестный этап.');
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
  if (typeof attackPlayers !== 'boolean' || !Number.isInteger(retaliationHits) || retaliationHits < 1 || retaliationHits > 10 || ![retaliationWindowMs, retreatHealth, dangerRadius, maxChaseDistance].every(n => Number.isFinite(n) && n > 0) || !Array.isArray(trustedPlayers)) throw new Error('Неверная политика защиты.');
  return { id: 'mckudo:defense', apiVersion: 1,
    react(observation) {
      const p = observation.self?.position;
      if (!p || !Array.isArray(observation.entities)) return { action: null, reason: 'Недостаточно наблюдений для оценки угроз.' };
      const threats = observation.entities.map(e => ({ ...e, distance: e.position ? Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) : Infinity }))
        .filter(e => e.distance <= maxChaseDistance && (e.hostile === true && e.distance <= dangerRadius || e.kind === 'player' && attackPlayers && !trustedPlayers.includes(e.username) &&
          (observation.combat?.attackers || []).some(a => a.entityId === e.id && a.hits >= retaliationHits && clock() - a.lastHitAt >= 0 && clock() - a.lastHitAt <= retaliationWindowMs)))
        .sort((a, b) => a.distance - b.distance);
      const target = threats[0];
      if (!target) return { action: null, reason: 'Подтверждённых угроз нет.' };
      const retreat = observation.self.health == null || observation.self.health <= retreatHealth || target.name === 'creeper';
      return { priority: 1000, action: { skill: retreat ? 'flee' : 'attack', args: { entityId: target.id, maxDistance: maxChaseDistance } },
        reason: retreat ? 'Отступление от угрозы.' : target.kind === 'player' ? 'Ответ на подтверждённое нападение игрока.' : 'Защита от враждебного моба.' };
    }
  };
}
