import { EventEmitter } from 'node:events';
import { validateConfig, jsonCopy, id, object } from './config.js';
import { matches, explainCondition } from './conditions.js';
import { MCKUDO } from './identity.js';
import { WorkflowPlanner } from './workflows.js';
import { SkillRegistry } from './skills.js';
import { GoalBrain } from './brain.js';
import { normalizeObservation } from './perception.js';

export class MckudoCore extends EventEmitter {
  #config; #adapter; #skills; #workflows; #clock; #pending = null; #abort; #timer; #loop = false; #paused = false;
  #cooldowns = new Map(); #stats = Object.create(null); #history = []; #state; #generation = 0; #listenerErrors = [];
  #brain = null; #tickNumber = 0; #reactors;
  constructor({ config, adapter, memory, planning, reactors = [], clock = Date.now }) {
    super();
    this.#config = validateConfig(config);
    if (!Array.isArray(reactors) || reactors.length > 16 || new Set(reactors.map(r => r?.id)).size !== reactors.length || reactors.some(r => !id(r?.id) || r.apiVersion !== 1 || typeof r.react !== 'function')) throw new Error('Нужно до 16 уникальных Reactor: id, apiVersion: 1, react().');
    this.#reactors = [...reactors];
    if (!reactors.length && !this.#config.rules.length && !this.#config.workflows.length && !this.#config.goals.length) throw new Error('Добавь правила, задачи, цели или Reactor.');
    if (!adapter || typeof adapter.observe !== 'function' || typeof adapter.execute !== 'function' || typeof adapter.describe !== 'function') throw new TypeError('Адаптер должен реализовать describe(), observe() и execute().');
    this.#adapter = adapter; this.#clock = clock;
    const manifest = jsonCopy(adapter.describe());
    if (manifest.protocolVersion !== 1 || !Array.isArray(manifest.skills) || !manifest.skills.every(id)) throw new TypeError('Адаптер: нужен protocolVersion: 1 и список skills.');
    this.manifest = Object.freeze({ ...manifest, skills: Object.freeze([...manifest.skills]) });
    this.#skills = new SkillRegistry(manifest.skills);
    if (memory !== undefined) this.#restore(memory);
    this.#workflows = new WorkflowPlanner(this.#config.workflows, memory?.workflows);
    if (this.#config.goals.length) {
      if (!planning) throw new Error('Для goals передай planning: { operators, planner? }.');
      this.#brain = new GoalBrain(this.#config.goals, planning, clock, memory?.brain);
    } else if (planning || memory?.brain) throw new Error('Для planning или памяти мозга добавь goals в конфигурацию.');
    this.#state = { engine: MCKUDO, name: this.#config.name, worldId: this.#config.worldId, status: 'idle', reason: 'Ожидание первого наблюдения.', decision: null, observation: null, adapter: manifest, lastResult: null };
  }
  #restore(input) {
    const m = jsonCopy(input, '$', 1048576);
    if (![1, 2, 3].includes(m.schemaVersion) || m.worldId !== this.#config.worldId || !object(m.stats) || !Array.isArray(m.history)) throw new TypeError('Память другого мира или неподдерживаемого формата.');
    const names = [...this.#config.rules.map(r => r.id), ...this.#config.workflows.flatMap(w => w.steps.map(s => JSON.stringify(['workflow', w.id, s.id]))), ...this.#config.goals.map(g => JSON.stringify(['goal', g.id]))];
    for (const name of names) {
      const s = Object.hasOwn(m.stats, name) ? m.stats[name] : null;
      if (s) {
        if (!['successes', 'failures', 'streak'].every(k => Number.isSafeInteger(s[k]) && s[k] >= 0)) throw new TypeError('Повреждены счётчики памяти.');
        this.#stats[name] = { successes: s.successes, failures: s.failures, streak: s.streak };
      }
    }
    this.#history = m.history.slice(-this.#config.maxHistory);
  }
  registerSkill(name, handler, { validate } = {}) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); this.#skills.register(name, handler, validate); return this; }
  use(plugin) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); this.#skills.use(plugin); return this; }
  removePlugin(id) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); this.#skills.remove(id); return this; }
  resetWorkflow(id) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); this.#workflows.reset(id); return this; }
  retryStep(workflow, step) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); this.#workflows.retry(workflow, step); return this; }
  retryGoal(goalId) { if (this.#pending) throw new Error('Сначала дождись завершения текущего шага.'); if (!this.#brain) throw new Error('Мозг не подключён.'); this.#brain.retry(goalId); return this; }
  snapshot() { return jsonCopy({ ...this.#state, paused: this.#paused, running: this.#loop, history: this.#history,
    workflows: this.#workflows.snapshot(), brain: this.#brain?.snapshot() ?? null, plugins: this.#skills.snapshot(), listenerErrors: this.#listenerErrors }, '$', 1048576); }
  exportMemory() { return jsonCopy({ schemaVersion: this.#brain ? 3 : 2, worldId: this.#config.worldId, stats: this.#stats, history: this.#history, workflows: this.#workflows.export(), ...(this.#brain ? { brain: this.#brain.export() } : {}) }, '$', 1048576); }
  async #observe(signal) {
    const o = await this.#adapter.observe({ signal }); signal.throwIfAborted();
    return this.manifest.perceptionVersion === 1 ? normalizeObservation(o) : jsonCopy(o);
  }
  #reactions(observation) {
    return this.#reactors.map(reactor => {
      try {
        const r = jsonCopy(reactor.react(jsonCopy(observation)));
        if (!object(r) || typeof r.reason !== 'string' || r.reason.length > 500) throw new Error('Reactor должен вернуть action и reason (до 500 символов).');
        if (r.action === null) return { id: reactor.id, kind: 'reactor', active: false, reason: r.reason };
        if (!object(r.action) || !id(r.action.skill) || !Number.isInteger(r.priority) || r.priority < -1000 || r.priority > 1000) throw new Error('Reactor: неверные action или priority.');
        r.action.args ??= {}; if (!object(r.action.args)) throw new Error('Reactor args: нужен объект.');
        return { id: reactor.id, kind: 'reactor', active: true, priority: r.priority, action: r.action, description: r.reason, memoryKey: JSON.stringify(['reactor', reactor.id]) };
      } catch (error) { return { id: reactor.id, kind: 'reactor', active: false, reason: String(error.message).slice(0, 500), error: true }; }
    });
  }
  #publish(event, payload) {
    const failed = error => { this.#listenerErrors.push({ event, message: String(error?.message || error).slice(0, 300) }); this.#listenerErrors = this.#listenerErrors.slice(-10); };
    for (const listener of this.rawListeners(event)) {
      try { const result = listener.call(this, jsonCopy(payload, '$', 1048576)); if (result && typeof result.then === 'function') Promise.resolve(result).catch(failed); }
      catch (error) { failed(error); }
    }
  }
  #notify() { this.#publish('state', this.snapshot()); }
  #context(o) {
    const p = o.self?.position;
    return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? `${o.dimension || 'world'}:${Math.floor(p.x / 8)}:${Math.floor(p.z / 8)}` : 'world';
  }
  tick() {
    if (this.#pending) return this.#pending;
    if (this.#paused) return Promise.resolve(this.snapshot());
    // Defer execution until the lock exists, including events emitted synchronously by adapters.
    this.#pending = Promise.resolve().then(() => this.#step()).finally(() => { this.#pending = null; });
    return this.#pending;
  }
  async #step() {
    if (this.#paused) return this.snapshot();
    const ac = new AbortController(); this.#abort = ac;
    let timedOut = false, plan = null, context = 'world', began = false;
    const timeout = setTimeout(() => { timedOut = true; ac.abort(new Error('Истекло время задачи.')); }, this.#config.actionTimeoutMs);
    try {
      this.#state.status = 'observing'; this.#state.decision = null;
      let o = await this.#observe(ac.signal);
      this.#state.observation = o; context = this.#context(o);
      const now = this.#clock();
      this.#state.trace = { tick: ++this.#tickNumber, at: now, rules: this.#config.rules.map(r => ({ id: r.id, priority: r.priority, ...explainCondition(r.when, o) })), candidates: [], selected: null };
      for (const [key, until] of this.#cooldowns) if (until <= now) this.#cooldowns.delete(key);
      const reactions = this.#reactions(o); this.#state.trace.reactors = reactions.map(r => ({ id: r.id, active: r.active, reason: r.description || r.reason, error: r.error || false }));
      const applicable = [...reactions.filter(r => r.active), ...this.#config.rules.filter(r => matches(r.when, o)).map(r => ({ ...r, kind: 'rule', memoryKey: r.id })), ...this.#workflows.candidates(o, now), ...(this.#brain?.candidates(o, now) ?? [])].sort((a, b) => b.priority - a.priority);
      const candidates = applicable.map(r => ({ ...r, blocked: r.blocked || (r.kind !== 'goal' && !this.#skills.has(r.action.skill) ? 'Адаптер не поддерживает навык.' : ['rule', 'reactor'].includes(r.kind) && this.#cooldowns.has(context + '/' + r.memoryKey) ? 'Пауза после ошибки в этой области.' : null) }));
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].blocked) continue;
        if (candidates[i].kind === 'goal') {
          this.#state.status = 'planning';
          candidates[i] = await this.#brain.propose(candidates[i], o, this.#skills.names(), ac.signal);
          ac.signal.throwIfAborted();
        }
        if (!candidates[i].blocked) { plan = candidates[i]; break; }
      }
      this.#state.trace.candidates = candidates.map(r => ({ id: r.id, kind: r.kind, priority: r.priority, blocked: r.blocked }));
      this.#state.trace.selected = plan ? { id: plan.id, kind: plan.kind, operatorId: plan.operatorId ?? null } : null;
      if (plan?.kind === 'goal') {
        const fresh = await this.#observe(ac.signal);
        const urgent = [...this.#config.rules.filter(r => matches(r.when, fresh)).map(r => ({ ...r, memoryKey: r.id })), ...this.#reactions(fresh).filter(r => r.active)]
          .some(r => r.priority >= plan.priority && this.#skills.has(r.action.skill) && !this.#cooldowns.has(this.#context(fresh) + '/' + r.memoryKey));
        this.#state.observation = fresh;
        if (!this.#brain.isCurrent(plan, fresh) || urgent) {
          this.#state.status = 'idle'; this.#state.reason = urgent ? 'После планирования появилась приоритетная реакция.' : 'Мир изменился во время планирования; нужно новое решение.';
          this.#state.trace.selected = null; this.#state.trace.deferred = this.#state.reason;
          this.#publish('decision:trace', this.#state.trace); this.#notify(); return this.snapshot();
        }
        o = fresh; context = this.#context(o);
      }
      this.#publish('decision:trace', this.#state.trace);
      if (!plan) {
        const troubled = this.#workflows.snapshot().find(w => ['failed', 'interrupted'].includes(w.status));
        this.#state.status = candidates.length || troubled ? 'blocked' : 'idle';
        this.#state.reason = candidates[0]?.blocked || (troubled ? `Задача ${troubled.id}: ${troubled.status}. Нужен явный повтор шага.` : 'Нет правил или шагов, готовых к выполнению.');
        this.#notify(); return this.snapshot();
      }
      this.#state.decision = jsonCopy({ id: plan.id, kind: plan.kind, workflowId: plan.workflowId || null, stepId: plan.stepId || null,
        goalId: plan.goalId || null, operatorId: plan.operatorId || null,
        action: plan.action, priority: plan.priority, alternatives: candidates.filter(r => r !== plan).map(r => ({ id: r.id, blocked: r.blocked })) });
      this.#state.status = 'acting'; this.#state.reason = plan.description || `Выполнено условие правила ${plan.id}; выбрано по приоритету ${plan.priority}.`;
      if (plan.kind === 'workflow') this.#workflows.begin(plan);
      if (plan.kind === 'goal') this.#brain.begin(plan);
      began = true;
      this.#notify(); this.#publish('action:start', this.#state.decision);
      ac.signal.throwIfAborted();
      const handler = this.#skills.get(plan.action.skill);
      if (handler?.validate) {
        const valid = await handler.validate(jsonCopy(plan.action.args)); ac.signal.throwIfAborted();
        if (valid === false || typeof valid === 'string') throw new Error(typeof valid === 'string' ? valid : 'Параметры навыка не прошли проверку.');
      }
      const result = handler ? await handler.execute(jsonCopy(plan.action.args), { signal: ac.signal, observation: jsonCopy(o) }) : await this.#adapter.execute(jsonCopy(plan.action), { signal: ac.signal });
      ac.signal.throwIfAborted();
      if (result?.ok === false) throw new Error(String(result.message || 'Навык сообщил о неудаче.'));
      let outcome = 'success';
      if (plan.until || plan.kind === 'goal') {
        const after = await this.#observe(ac.signal); this.#state.observation = after;
        if (plan.until && !matches(plan.until, after)) outcome = 'progress';
      }
      this.#record(plan, context, outcome);
      this.#state.status = this.#state.lastResult?.outcome === 'failure' ? 'fault' : 'idle';
      this.#state.reason = this.#state.status === 'fault' ? this.#state.lastResult.detail : 'Действие завершено. Следующий шаг начнётся с нового наблюдения.';
    } catch (error) {
      const cancelled = ac.signal.aborted && !timedOut;
      const message = timedOut ? 'Истекло время задачи.' : String(error?.message || error).slice(0, 300);
      if (plan && began) this.#record(plan, context, cancelled ? 'cancelled' : 'failure', message);
      this.#state.status = cancelled ? 'paused' : 'fault'; this.#state.reason = message;
    } finally { clearTimeout(timeout); if (this.#abort === ac) this.#abort = null; }
    this.#notify(); return this.snapshot();
  }
  #record(plan, context, outcome, detail = '') {
    if (plan.kind === 'goal') {
      outcome = this.#brain.finish(plan, outcome, this.#state.observation, detail);
      if (outcome === 'failure' && !detail) detail = 'Наблюдение не подтвердило ожидаемый эффект; план отброшен.';
    }
    if (plan.kind === 'workflow') this.#workflows.finish(plan, outcome, detail, this.#clock());
    if (['success', 'failure'].includes(outcome)) {
      const s = this.#stats[plan.memoryKey] ||= { successes: 0, failures: 0, streak: 0 };
      if (outcome === 'success') { s.successes++; s.streak = 0; }
      else { s.failures++; s.streak++; if (['rule', 'reactor'].includes(plan.kind)) this.#cooldowns.set(context + '/' + plan.memoryKey, this.#clock() + Math.min(300000, this.#config.failureBackoffMs * 2 ** Math.min(s.streak - 1, 6))); }
    }
    const result = { at: this.#clock(), rule: plan.id, skill: plan.action.skill, outcome, detail };
    this.#history.push(result); this.#history = this.#history.slice(-this.#config.maxHistory);
    this.#state.lastResult = result; this.#publish('action:finish', result);
  }
  start() {
    if (this.#loop) { this.resume(); return this; }
    this.#loop = true; this.#paused = false; const generation = ++this.#generation;
    const next = async () => {
      if (!this.#loop || generation !== this.#generation) return;
      try { await this.tick(); } catch (e) { this.#state.status = 'fault'; this.#state.reason = String(e.message).slice(0, 300); }
      if (this.#loop && generation === this.#generation) this.#timer = setTimeout(next, this.#config.tickIntervalMs);
    };
    void next(); return this;
  }
  pause() {
    this.#paused = true; this.#abort?.abort(new Error('Действие остановлено пользователем.'));
    this.#state.status = this.#pending ? 'stopping' : 'paused'; this.#state.reason = 'Пауза запрошена.'; this.#notify();
    return this.#pending || Promise.resolve(this.snapshot());
  }
  resume() { this.#paused = false; this.#state.status = this.#pending ? 'stopping' : 'idle'; return this; }
  async stop() { this.#loop = false; this.#generation++; clearTimeout(this.#timer); await this.pause(); }
}
export const createCore = options => new MckudoCore(options);
