import { createHash } from 'node:crypto';
import { jsonCopy, object } from './config.js';
import { matches } from './conditions.js';
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = definition => createHash('sha256').update(JSON.stringify(canonical(definition))).digest('hex');
const emptyStep = () => ({ status: 'pending', attempts: 0, retryAt: 0, error: '' });
export class WorkflowPlanner {
  #definitions; #states = new Map();
  constructor(definitions, saved = {}) {
    this.#definitions = definitions;
    if (!object(saved)) throw new Error('Повреждена память задач.');
    for (const w of definitions) {
      const state = { fingerprint: fingerprint(w), active: false, steps: Object.fromEntries(w.steps.map(s => [s.id, emptyStep()])) };
      if (Object.hasOwn(saved, w.id)) {
        const old = saved[w.id];
        if (old.fingerprint !== state.fingerprint) throw new Error(`Изменилась задача ${w.id}. Используй новую память или явно удали её старый прогресс.`);
        if (typeof old.active !== 'boolean' || !object(old.steps)) throw new Error('Повреждена память задач.');
        state.active = old.active;
        for (const s of w.steps) {
          const entry = old.steps[s.id];
          if (!entry || !['pending', 'running', 'completed', 'failed', 'interrupted'].includes(entry.status) || !Number.isInteger(entry.attempts) || entry.attempts < 0 || entry.attempts > s.maxAttempts || !Number.isFinite(entry.retryAt) || typeof entry.error !== 'string') throw new Error(`Повреждён шаг ${w.id}/${s.id}.`);
          state.steps[s.id] = { ...emptyStep(), status: entry.status === 'running' ? 'interrupted' : entry.status, attempts: entry.attempts, retryAt: entry.retryAt, error: entry.error.slice(0, 300) };
        }
      }
      this.#states.set(w.id, state);
    }
  }
  #get(workflowId, stepId) {
    const definition = this.#definitions.find(w => w.id === workflowId), state = this.#states.get(workflowId);
    if (!definition) throw new Error(`Нет задачи ${workflowId}.`);
    const step = definition.steps.find(s => s.id === stepId);
    if (stepId !== undefined && !step) throw new Error(`Нет шага ${workflowId}/${stepId}.`);
    return { definition, state, step, entry: step && state.steps[stepId] };
  }
  candidates(observation, now) {
    const out = [];
    for (const w of this.#definitions) {
      const state = this.#states.get(w.id);
      if (!state.active && matches(w.when, observation)) state.active = true;
      if (!state.active || Object.values(state.steps).some(s => ['failed', 'interrupted'].includes(s.status))) continue;
      // Resolve already satisfied steps in topological order, even if the JSON lists dependencies later.
      for (let pass = 0; pass < w.steps.length; pass++) {
        let changed = false;
        for (const s of w.steps) {
          const entry = state.steps[s.id];
          if (entry.status === 'pending' && s.until && s.dependsOn.every(d => state.steps[d].status === 'completed') && matches(s.until, observation)) {
            entry.status = 'completed'; entry.error = ''; changed = true;
          }
        }
        if (!changed) break;
      }
      for (const s of w.steps) {
        const entry = state.steps[s.id];
        if (entry.status !== 'pending' || !s.dependsOn.every(d => state.steps[d].status === 'completed')) continue;
        out.push({ id: `${w.id}/${s.id}`, kind: 'workflow', workflowId: w.id, stepId: s.id,
          memoryKey: JSON.stringify(['workflow', w.id, s.id]), priority: w.priority, description: w.description || `Задача ${w.id}, шаг ${s.id}.`,
          action: s.action, until: s.until || null, blocked: entry.retryAt > now ? 'Ожидание повторной попытки шага.' : null });
      }
    }
    return out;
  }
  begin(plan) { const { entry } = this.#get(plan.workflowId, plan.stepId); entry.status = 'running'; entry.attempts++; }
  finish(plan, outcome, detail, now) {
    const { step, entry } = this.#get(plan.workflowId, plan.stepId);
    entry.error = detail || ''; entry.retryAt = 0;
    if (outcome === 'cancelled') { entry.attempts = Math.max(0, entry.attempts - 1); entry.status = 'pending'; return; }
    if (outcome === 'success') { entry.status = 'completed'; return; }
    if (entry.attempts >= step.maxAttempts) { entry.status = 'failed'; entry.error ||= 'Исчерпан лимит попыток достижения результата.'; return; }
    entry.status = 'pending';
    if (outcome === 'failure') entry.retryAt = now + Math.min(300000, step.retryDelayMs * 2 ** Math.min(entry.attempts - 1, 6));
  }
  reset(id) {
    const { definition, state } = this.#get(id);
    state.active = false; state.steps = Object.fromEntries(definition.steps.map(s => [s.id, emptyStep()]));
  }
  retry(workflowId, stepId) {
    const { entry } = this.#get(workflowId, stepId);
    if (!['failed', 'interrupted'].includes(entry.status)) throw new Error('Повтор доступен только для ошибочного или прерванного шага.');
    Object.assign(entry, emptyStep());
  }
  snapshot() {
    return this.#definitions.map(w => {
      const state = this.#states.get(w.id), entries = Object.values(state.steps);
      const completed = entries.filter(s => s.status === 'completed').length;
      const status = completed === entries.length ? 'completed' : entries.some(s => s.status === 'interrupted') ? 'interrupted' : entries.some(s => s.status === 'failed') ? 'failed' : state.active ? 'active' : 'pending';
      return jsonCopy({ id: w.id, status, completed, total: entries.length, steps: state.steps });
    });
  }
  export() { return jsonCopy(Object.fromEntries(this.#states)); }
}
