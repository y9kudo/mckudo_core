import { normalizeActionFailure } from '../packages/kudoconnect/src/failures.js';
import { jsonCopy } from './config.js';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const name = v => typeof v === 'string' && v.length > 0 && v.length <= 128;
const actionKey = action => {
  if (!name(action?.skill)) throw new Error('Evidence memory: нужен skill действия.');
  const key = JSON.stringify(canonical(jsonCopy(action, '$', 16384)));
  if (key.length > 16384) throw new Error('Evidence memory: действие больше 16 KiB.');
  return key;
};
const repairs = {
  START_UNSUPPORTED: 'Проверить опору, положение ног и свободное место над головой; выбрать подтверждённую позицию старта.',
  NO_PATH: 'Проверить другой подход, доступные чанки и разрешённые способы перемещения.',
  SEARCH_BUDGET: 'Разбить маршрут на участки или запланировать поиск с другим бюджетом.',
  STEP_STALLED: 'Перепроверить столкновения и фактическое положение перед новым маршрутом.',
  OCCUPIED: 'Дождаться освобождения прохода или выбрать обход.',
  SERVER_CORRECTION: 'Сверить физическую модель с серверной позицией.',
  STALE_WORLD: 'Получить новое наблюдение и перепланировать.',
  SUPPORT_CHANGED: 'Повторно проверить опору и проход.',
  ACTION_FAILED: 'Получить новое наблюдение и уточнить причину отказа.'
};

/**
 * A failed attempt is an observation, not a permanent ban on an action.
 * Only a complete, known start-cell certificate may be shared as a hard veto.
 * Other failures have bounded, agent-local backoff: crowds and corrections do
 * not prove that another agent cannot execute the same action.
 */
export function createActionEvidenceMemory({ worldId, maxEntries = 256, retryMs = 2000, clock = Date.now } = {}) {
  if (!name(worldId) || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096 || !Number.isInteger(retryMs) || retryMs < 100 || retryMs > 30000 || typeof clock !== 'function') throw new Error('Evidence memory: worldId, maxEntries 1–4096, retryMs 100–30000 и clock.');
  const entries = new Map();
  const stats = { recorded: 0, avoided: 0, sharedAvoided: 0, reconsidered: 0 };
  const query = ({ agentId, dimension, action }) => {
    if (!name(agentId) || !name(dimension)) throw new Error('Evidence memory: agentId и dimension.');
    return { agentId, dimension, key: actionKey(action), skill: action.skill };
  };
  return {
    worldId,
    record(input) {
      const q = query(input), failure = normalizeActionFailure(input.failure);
      const facts = failure.evidence?.facts || {};
      // The native planner supplies exactly the cells which falsified its start
      // precondition. A free-form code without these facts gets only a timer.
      const conditional = q.skill === 'navigate' && failure.code === 'START_UNSUPPORTED' && failure.evidence?.complete === true &&
        typeof facts.position === 'string' && facts.navigationMode === 'ground' && Object.keys(facts).some(k => k.startsWith('block:')) && Object.values(facts).every(v => v !== null);
      const key = conditional ? `skill:${q.skill}` : q.key;
      const id = JSON.stringify([q.dimension, key, conditional ? '*' : q.agentId, failure.code, canonical(facts)]);
      const previous = entries.get(id), attempts = (previous?.attempts || 0) + 1;
      const record = { ...q, key, code: failure.code, facts, mode: conditional ? 'condition' : 'timer', agentId: q.agentId, attempts,
        at: clock(), until: conditional ? null : clock() + Math.min(120000, retryMs * 2 ** Math.min(attempts - 1, 6)) };
      entries.delete(id); entries.set(id, record);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      stats.recorded++;
      return structuredClone(record);
    },
    assess(input) {
      const q = query(input);
      if (typeof input.readFact !== 'function') throw new Error('Evidence memory: нужен readFact.');
      let changed = [], unknown = [];
      for (const record of [...entries.values()].reverse()) {
        if (record.dimension !== q.dimension || record.key !== q.key && record.key !== `skill:${q.skill}` || record.mode === 'timer' && record.agentId !== q.agentId) continue;
        if (record.until !== null && clock() >= record.until) continue;
        const differences = [], missing = [];
        for (const [fact, value] of Object.entries(record.facts)) {
          const actual = input.readFact(fact);
          if (actual === null || actual === undefined) missing.push(fact);
          else if (actual !== value) differences.push(fact);
        }
        // Unknown chunks invalidate the *use* of a certificate, without erasing
        // evidence still relevant to peers who can observe the original cells.
        if (differences.length || missing.length) { changed.push(...differences); unknown.push(...missing); continue; }
        stats.avoided++;
        if (record.agentId !== q.agentId) stats.sharedAvoided++;
        return { blocked: true, code: record.code, mode: record.mode, sourceAgent: record.agentId, retryAt: record.until,
          reason: repairs[record.code], facts: Object.keys(record.facts) };
      }
      changed = [...new Set(changed)]; unknown = [...new Set(unknown)];
      if (changed.length || unknown.length) stats.reconsidered++;
      return { blocked: false, reason: changed.length ? 'Условия изменились; прежний отказ требует новой проверки.' : unknown.length ? 'Недостаточно наблюдений для применения прежнего отказа.' : 'Подходящего действующего отказа нет.', changedFacts: changed, unknownFacts: unknown };
    },
    snapshot() {
      return { worldId, maxEntries, ...stats, entries: structuredClone([...entries.values()]) };
    },
    clear() { entries.clear(); }
  };
}
