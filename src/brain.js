import { createHash } from 'node:crypto';
import { jsonCopy, id, object } from './config.js';
import { matches } from './conditions.js';
import { createSymbolicPlanner, validateOperators, validatePlan, conditionFacts, projectFacts, applyOperator, buildPlannerContext } from './planner.js';

const canonical = v => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const fingerprint = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');

export class GoalBrain {
  #goals; #operators; #planner; #clock; #states; #calls = 0; #lastCall = null; #cache = null; #blocked = new Map(); #options; #fingerprint;
  constructor(goals, options, clock, memory) {
    this.#goals = goals; this.#clock = clock;
    this.#options = { maxCalls: 100, minIntervalMs: 250, retryDelayMs: 1000, ...options };
    for (const [key, max] of [['maxCalls', 100000], ['minIntervalMs', 300000], ['retryDelayMs', 300000]]) {
      const value = this.#options[key];
      if (!Number.isInteger(value) || value < (key === 'minIntervalMs' ? 0 : 1) || value > max) throw new Error(`planning.${key}: неверный лимит.`);
    }
    this.#operators = validateOperators(options.operators);
    this.#planner = options.planner ?? createSymbolicPlanner();
    if (!id(this.#planner?.id) || this.#planner.apiVersion !== 1 || typeof this.#planner.plan !== 'function') throw new Error('Planner: нужны id, apiVersion: 1 и plan().');
    this.#fingerprint = fingerprint({ goals, operators: this.#operators, planner: this.#planner.id });
    this.#states = Object.fromEntries(goals.map(g => [g.id, { status: 'pending', actions: 0, reason: '', retryAt: 0, inFlight: false }]));
    if (memory !== undefined) {
      const m = jsonCopy(memory);
      if (!object(m) || m.fingerprint !== this.#fingerprint || !Number.isSafeInteger(m.calls) || m.calls < 0 || !object(m.goals)) throw new Error('Память мозга несовместима с целями, операторами или Planner.');
      this.#calls = m.calls;
      for (const goal of goals) {
        const s = m.goals[goal.id];
        if (!object(s) || !['pending', 'active', 'achieved', 'blocked', 'failed', 'interrupted'].includes(s.status) || !Number.isInteger(s.actions) || s.actions < 0 || s.actions > goal.maxActions || typeof s.reason !== 'string' || s.reason.length > 500 || !Number.isFinite(s.retryAt) || s.retryAt < 0 || typeof s.inFlight !== 'boolean') throw new Error('Повреждена память цели.');
        this.#states[goal.id] = { ...s, status: s.inFlight ? 'interrupted' : s.status, inFlight: false };
      }
    }
  }
  snapshot() { return jsonCopy({ planner: this.#planner.id, calls: this.#calls, maxCalls: this.#options.maxCalls,
    goals: this.#goals.map(g => ({ id: g.id, priority: g.priority, ...this.#states[g.id] })), plan: this.#cache ? { goalId: this.#cache.goalId, steps: this.#cache.steps, reason: this.#cache.reason } : null }); }
  export() { return jsonCopy({ fingerprint: this.#fingerprint, calls: this.#calls, goals: this.#states }); }
  isCurrent(plan, observation) { return fingerprint(projectFacts(observation, plan.pointers)) === plan.observedSignature; }
  retry(goalId) {
    const state = this.#states[goalId];
    if (!state) throw new Error('Неизвестная цель.');
    Object.assign(state, { status: 'pending', actions: 0, retryAt: 0, reason: '', inFlight: false });
    this.#cache = null; this.#blocked.clear();
  }
  candidates(observation, now) {
    return this.#goals.map(g => {
      const s = this.#states[g.id];
      // Goals describe a maintained world condition, unlike one-shot workflows.
      if (!['interrupted', 'failed'].includes(s.status)) {
        if (matches(g.desired, observation)) { s.status = 'achieved'; s.reason = 'Цель подтверждена наблюдением.'; }
        else if (s.status === 'achieved') { s.status = 'pending'; }
      }
      const blocked = ['interrupted', 'failed'].includes(s.status) ? 'Нужен явный retryGoal().' : s.actions >= g.maxActions && s.status !== 'achieved' ? 'Исчерпан лимит действий цели.' : s.retryAt > now ? 'Пауза перед новым планированием.' : null;
      if (s.actions >= g.maxActions && s.status !== 'achieved' && s.status !== 'interrupted') s.status = 'failed';
      return { id: g.id, goalId: g.id, kind: 'goal', priority: g.priority, description: g.description, blocked, achieved: s.status === 'achieved' };
    }).filter(g => !g.achieved);
  }
  async propose(candidate, observation, skills, signal) {
    const goal = this.#goals.find(g => g.id === candidate.goalId), state = this.#states[goal.id], now = this.#clock();
    for (const [name, until] of this.#blocked) if (until <= now) this.#blocked.delete(name);
    const operators = this.#operators.filter(op => skills.includes(op.action.skill) && !this.#blocked.has(op.id));
    const pointers = [...new Set([...conditionFacts(goal.desired), ...operators.flatMap(op => [...conditionFacts(op.requires), ...op.effects.map(e => e.fact)])])].sort();
    const signature = fingerprint({ facts: projectFacts(observation, pointers), operators: operators.map(o => o.id), skills });
    if (!operators.length) {
      state.status = 'blocked'; state.reason = 'Нет доступных операторов для планирования.'; state.retryAt = now + this.#options.retryDelayMs;
      this.#cache = null; return { ...candidate, blocked: state.reason };
    }
    const context = buildPlannerContext({ observation, goal, operators, skills });
    const block = reason => { state.status = 'blocked'; state.reason = reason; state.retryAt = now + this.#options.retryDelayMs; this.#cache = null; return { ...candidate, blocked: reason }; };
    if (!this.#cache || this.#cache.goalId !== goal.id || this.#cache.signature !== signature || !this.#cache.steps.length) {
      this.#cache = null;
      if (this.#calls >= this.#options.maxCalls) return block('Исчерпан бюджет вызовов Planner.');
      if (this.#lastCall !== null && now - this.#lastCall < this.#options.minIntervalMs) return block('Ограничение частоты вызовов Planner.');
      this.#calls++; this.#lastCall = now;
      let result;
      try {
        // Custom/LLM planners receive JSON data and a signal, never the executor itself.
        const answer = await this.#planner.plan(jsonCopy(context), { signal });
        signal.throwIfAborted();
        result = validatePlan(answer, context);
      } catch (error) {
        if (signal.aborted) throw error;
        return block(`Planner: ${String(error?.message || error).slice(0, 400)}`);
      }
      if (!result.steps.length) return block(result.reason);
      this.#cache = { goalId: goal.id, steps: result.steps, reason: result.reason, signature };
    }
    const op = operators.find(o => o.id === this.#cache.steps[0]);
    const predicted = op && applyOperator(observation, op);
    if (!predicted) return block('Предпосылки плана изменились.');
    state.status = 'active'; state.reason = this.#cache.reason; state.retryAt = 0;
    return { ...candidate, operatorId: op.id, action: op.action, memoryKey: JSON.stringify(['goal', goal.id]),
      predicted, effectFacts: op.effects.map(e => e.fact), pointers, operatorIds: operators.map(o => o.id), skills,
      observedSignature: fingerprint(projectFacts(observation, pointers)),
      description: this.#cache.reason, blocked: null };
  }
  begin(plan) { const s = this.#states[plan.goalId]; s.inFlight = true; s.actions++; }
  finish(plan, outcome, observation, detail) {
    const s = this.#states[plan.goalId]; s.inFlight = false;
    if (outcome === 'cancelled') { s.actions--; s.status = 'pending'; this.#cache = null; return outcome; }
    if (outcome !== 'failure' && fingerprint(projectFacts(observation, plan.effectFacts)) !== fingerprint(projectFacts(plan.predicted, plan.effectFacts))) {
      outcome = 'failure'; detail = 'Наблюдение не подтвердило ожидаемый эффект; план отброшен.';
    }
    if (outcome === 'failure') {
      s.status = s.actions >= this.#goals.find(g => g.id === plan.goalId).maxActions ? 'failed' : 'blocked';
      s.reason = detail; s.retryAt = this.#clock() + this.#options.retryDelayMs;
      this.#blocked.set(plan.operatorId, this.#clock() + this.#options.retryDelayMs * 4); this.#cache = null;
      return outcome;
    }
    const reached = matches(this.#goals.find(g => g.id === plan.goalId).desired, observation);
    s.status = reached ? 'achieved' : 'active'; s.reason = reached ? 'Цель подтверждена наблюдением.' : 'Эффект подтверждён. Следующий шаг — после нового наблюдения.';
    if (this.#cache) {
      this.#cache.steps.shift();
      this.#cache.signature = fingerprint({ facts: projectFacts(plan.predicted, plan.pointers), operators: plan.operatorIds, skills: plan.skills });
    }
    return reached ? 'success' : 'progress';
  }
}
