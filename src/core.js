import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { validateConfig, jsonCopy, id, object } from './config.js';
import { matches, explainCondition } from './conditions.js';
import { MCKUDO } from './identity.js';
import { WorkflowPlanner } from './workflows.js';
import { SkillRegistry } from './skills.js';
import { GoalBrain } from './brain.js';
import { normalizeObservation } from './perception.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export class MckudoCore extends EventEmitter {
  #config; #adapter; #skills; #workflows; #clock; #pending = null; #abort; #timer; #loop = false; #paused = false;
  #cooldowns = new Map(); #stats = Object.create(null); #history = []; #state; #generation = 0; #listenerErrors = [];
  #actionFailures = new Map();
  #wakeMonitor = null;
  #brain = null; #tickNumber = 0; #reactors; #preemptionMs; #urgent = false; #unsubscribeUrgent; #learning; #session = randomUUID();
  constructor({ config, adapter, memory, planning, learning = planning?.experience, reactors = [], preemptionMs = 50, clock = Date.now }) {
    super();
    this.#config = validateConfig(config);
    if (learning && (learning.worldId !== this.#config.worldId || typeof learning.record !== 'function' || typeof learning.assess !== 'function')) throw new Error('Модель опыта должна принадлежать тому же worldId.');
    this.#learning = learning;
    if (!Array.isArray(reactors) || reactors.length > 16 || new Set(reactors.map(r => r?.id)).size !== reactors.length || reactors.some(r => !id(r?.id) || r.apiVersion !== 1 || typeof r.react !== 'function')) throw new Error('Нужно до 16 уникальных Reactor: id, apiVersion: 1, react().');
    this.#reactors = [...reactors];
    if (reactors.some(r => r.failureScope !== undefined && !['reactor', 'action'].includes(r.failureScope))) throw new Error('Reactor failureScope: reactor или action.');
    if (!Number.isInteger(preemptionMs) || preemptionMs < 50 || preemptionMs > 2000) throw new Error('preemptionMs: 50–2000.');
    this.#preemptionMs = preemptionMs;
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
    const names = [...this.#reactors.map(r => JSON.stringify(['reactor', r.id])), ...this.#config.rules.map(r => r.id), ...this.#config.workflows.flatMap(w => w.steps.map(s => JSON.stringify(['workflow', w.id, s.id]))), ...this.#config.goals.map(g => JSON.stringify(['goal', g.id]))];
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
  #reactions(observation, interruptsOnly = false) {
    return this.#reactors.filter(r => !interruptsOnly || r.preempt === true).map(reactor => {
      try {
        const r = jsonCopy(reactor.react(jsonCopy(observation)));
        if (!object(r) || typeof r.reason !== 'string' || r.reason.length > 500) throw new Error('Reactor должен вернуть action и reason (до 500 символов).');
        if (r.action === null) return { id: reactor.id, kind: 'reactor', active: false, reason: r.reason };
        if (!object(r.action) || !id(r.action.skill) || !Number.isInteger(r.priority) || r.priority < -1000 || r.priority > 1000) throw new Error('Reactor: неверные action или priority.');
        r.action.args ??= {}; if (!object(r.action.args)) throw new Error('Reactor args: нужен объект.');
        const memoryKey = JSON.stringify(['reactor', reactor.id]);
        const cooldownKey = reactor.failureScope === 'action' ? memoryKey + '/' + createHash('sha256').update(JSON.stringify(canonical(r.action))).digest('hex') : memoryKey;
        return { id: reactor.id, kind: 'reactor', active: true, priority: r.priority, action: r.action, description: r.reason, memoryKey, cooldownKey };
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
  #notify() { if (this.listenerCount('state')) this.#publish('state', this.snapshot()); }
  #cooldownKey(plan, context) { return context + '/' + (plan.cooldownKey ?? plan.memoryKey); }
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
    let timedOut = false, plan = null, context = 'world', began = false, monitoring = false, monitorTimer, monitorPending, beforeAction, startedAt, monitorRunning = false, monitorRequested = false;
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
      const candidates = applicable.map(r => ({ ...r, blocked: r.blocked || (r.kind !== 'goal' && !this.#skills.has(r.action.skill) ? 'Адаптер не поддерживает навык.' : ['rule', 'reactor'].includes(r.kind) && this.#cooldowns.has(this.#cooldownKey(r, context)) ? 'Пауза после ошибки в этой области.' : null) }));
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
          .some(r => r.priority >= plan.priority && this.#skills.has(r.action.skill) && !this.#cooldowns.has(this.#cooldownKey(r, this.#context(fresh))));
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
      beforeAction = jsonCopy(o); startedAt = this.#clock();
      this.#notify(); this.#publish('action:start', this.#state.decision);
      ac.signal.throwIfAborted();
      const handler = this.#skills.get(plan.action.skill);
      if (handler?.validate) {
        const valid = await handler.validate(jsonCopy(plan.action.args)); ac.signal.throwIfAborted();
        if (valid === false || typeof valid === 'string') throw new Error(typeof valid === 'string' ? valid : 'Параметры навыка не прошли проверку.');
      }
      monitoring = this.#reactors.some(r => r.preempt === true);
      const poll = async () => {
        if (monitorRunning) { monitorRequested = true; return; }
        monitorRunning = true; monitorRequested = false;
        try {
          if (!monitoring || ac.signal.aborted) return;
          const fresh = this.#adapter.observeThreats ? await this.#adapter.observeThreats({ signal: ac.signal }) : await this.#observe(ac.signal);
          if (!monitoring || ac.signal.aborted) return;
          const urgent = this.#reactions(fresh, true).find(r => r.active && (r.priority > plan.priority || r.priority === plan.priority && r.id === plan.id && r.action.skill === 'flee' && plan.action.skill !== 'flee') && this.#skills.has(r.action.skill) && !this.#cooldowns.has(this.#cooldownKey(r, this.#context(fresh))));
          if (urgent) { this.#urgent = true; ac.abort(new Error(`Прерывание: ${urgent.description}`)); }
        } catch (error) {
          if (!ac.signal.aborted) this.#publish('monitor:error', { message: String(error.message).slice(0, 300) });
        } finally {
          monitorRunning = false;
          if (monitoring && !ac.signal.aborted) monitorTimer = setTimeout(() => { monitorPending = poll(); }, monitorRequested ? 0 : this.#preemptionMs);
        }
      };
      this.#wakeMonitor = () => {
        if (!monitoring || ac.signal.aborted) return;
        if (monitorRunning) { monitorRequested = true; return; }
        clearTimeout(monitorTimer); monitorTimer = setTimeout(() => { monitorPending = poll(); }, 0);
      };
      if (monitoring) monitorTimer = setTimeout(() => { monitorPending = poll(); }, this.#preemptionMs);
      let result;
      try { result = handler ? await handler.execute(jsonCopy(plan.action.args), { signal: ac.signal, observation: jsonCopy(o) }) : await this.#adapter.execute(jsonCopy(plan.action), { signal: ac.signal, priority: plan.priority }); }
      finally { monitoring = false; this.#wakeMonitor = null; clearTimeout(monitorTimer); await monitorPending; }
      ac.signal.throwIfAborted();
      if (result?.ok === false) throw new Error(String(result.message || 'Навык сообщил о неудаче.'));
      let outcome = 'success';
      if (plan.until || plan.kind === 'goal' || this.#learning) {
        const after = await this.#observe(ac.signal); this.#state.observation = after;
        if (plan.until && !matches(plan.until, after)) outcome = 'progress';
      }
      this.#record(plan, context, outcome);
      this.#learn(plan, beforeAction, this.#state.observation, this.#state.lastResult.outcome, startedAt);
      if (plan.priority >= 900 && this.#state.lastResult?.outcome !== 'failure') this.#urgent = true;
      this.#state.status = this.#state.lastResult?.outcome === 'failure' ? 'fault' : 'idle';
      this.#state.reason = this.#state.status === 'fault' ? this.#state.lastResult.detail : 'Действие завершено. Следующий шаг начнётся с нового наблюдения.';
    } catch (error) {
      const cancelled = ac.signal.aborted && !timedOut;
      const message = timedOut ? 'Истекло время задачи.' : String(error?.message || error).slice(0, 300);
      if (plan && began) this.#record(plan, context, cancelled ? 'cancelled' : 'failure', message);
      if (plan && began) this.#learn(plan, beforeAction, null, cancelled ? 'cancelled' : 'failure', startedAt);
      this.#state.status = cancelled ? this.#paused ? 'paused' : 'idle' : 'fault'; this.#state.reason = message;
    } finally { monitoring = false; this.#wakeMonitor = null; clearTimeout(monitorTimer); clearTimeout(timeout); if (this.#abort === ac) this.#abort = null; }
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
      if (outcome === 'success') { s.successes++; s.streak = 0; this.#actionFailures.delete(this.#cooldownKey(plan, context)); }
      else {
        s.failures++; s.streak++;
        if (['rule', 'reactor'].includes(plan.kind)) {
          const key = this.#cooldownKey(plan, context), scoped = plan.cooldownKey && plan.cooldownKey !== plan.memoryKey;
          const streak = scoped ? (this.#actionFailures.get(key) || 0) + 1 : s.streak;
          if (scoped) { this.#actionFailures.delete(key); this.#actionFailures.set(key, streak); }
          this.#cooldowns.set(key, this.#clock() + Math.min(300000, this.#config.failureBackoffMs * 2 ** Math.min(streak - 1, 6)));
          for (const map of [this.#actionFailures, this.#cooldowns]) while (map.size > 1024) map.delete(map.keys().next().value);
        }
      }
    }
    const result = { at: this.#clock(), rule: plan.id, skill: plan.action.skill, outcome, detail };
    this.#history.push(result); this.#history = this.#history.slice(-this.#config.maxHistory);
    this.#state.lastResult = result; this.#publish('action:finish', result);
  }
  #learn(plan, before, after, outcome, startedAt) {
    if (!this.#learning) return;
    try { this.#learning.record({ episodeId: `${this.#session}:${this.#tickNumber}`, action: plan.action, before, after, outcome, durationMs: Math.max(0, this.#clock() - startedAt) }); }
    catch (error) { this.#publish('monitor:error', { message: `Модель опыта: ${String(error.message).slice(0, 250)}` }); }
  }
  start() {
    if (this.#loop) { this.resume(); return this; }
    this.#loop = true; this.#paused = false; const generation = ++this.#generation;
    const next = async () => {
      if (!this.#loop || generation !== this.#generation) return;
      try { await this.tick(); } catch (e) { this.#state.status = 'fault'; this.#state.reason = String(e.message).slice(0, 300); }
      // The action has already yielded/finished. An emergency should not wait for
      // another polling interval before choosing its defensive action.
      if (this.#loop && generation === this.#generation) this.#timer = setTimeout(next, this.#urgent ? 0 : this.#config.tickIntervalMs);
      this.#urgent = false;
    };
    if (typeof this.#adapter.subscribeUrgent === 'function') this.#unsubscribeUrgent = this.#adapter.subscribeUrgent(() => {
      if (!this.#loop || this.#paused) return;
      this.#urgent = true;
      this.#wakeMonitor?.();
      if (!this.#pending) { clearTimeout(this.#timer); this.#timer = setTimeout(next, 0); }
    });
    void next(); return this;
  }
  pause() {
    this.#paused = true; this.#abort?.abort(new Error('Действие остановлено пользователем.'));
    this.#state.status = this.#pending ? 'stopping' : 'paused'; this.#state.reason = 'Пауза запрошена.'; this.#notify();
    return this.#pending || Promise.resolve(this.snapshot());
  }
  resume() { this.#paused = false; this.#state.status = this.#pending ? 'stopping' : 'idle'; return this; }
  async stop() { this.#loop = false; this.#generation++; clearTimeout(this.#timer); this.#unsubscribeUrgent?.(); this.#unsubscribeUrgent = undefined; await this.pause(); }
}
export const createCore = options => new MckudoCore(options);
