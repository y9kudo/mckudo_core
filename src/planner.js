import { setImmediate as yieldTurn } from 'node:timers/promises';
import { jsonCopy, object, id, validateCondition } from './config.js';
import { factAt, matches } from './conditions.js';

const primitive = x => x === null || ['string', 'number', 'boolean'].includes(typeof x);
const parts = p => p.slice(1).split('/').map(v => v.replace(/~1/g, '/').replace(/~0/g, '~'));
export function conditionFacts(c) {
  if (!c) return [];
  if (c.all || c.any) return (c.all || c.any).flatMap(conditionFacts);
  return c.not ? conditionFacts(c.not) : [c.fact];
}
export function validateOperators(input) {
  const operators = jsonCopy(input);
  if (!Array.isArray(operators) || !operators.length || operators.length > 64) throw new Error('Нужно 1–64 оператора планирования.');
  const names = new Set();
  for (const op of operators) {
    if (!object(op) || Object.keys(op).some(k => !['id', 'action', 'requires', 'effects', 'cost'].includes(k)) || !id(op.id) || names.has(op.id)) throw new Error('Оператору нужен уникальный id и допустимые поля.');
    names.add(op.id);
    if (!object(op.action) || Object.keys(op.action).some(k => !['skill', 'args'].includes(k)) || !id(op.action.skill)) throw new Error(`Оператор ${op.id}: неверное action.`);
    if (op.action.args === undefined) op.action.args = {};
    if (!object(op.action.args)) throw new Error(`Оператор ${op.id}: args должны быть объектом.`);
    if (op.requires !== undefined) validateCondition(op.requires, `operators.${op.id}.requires`);
    if (op.cost === undefined) op.cost = 1;
    if (!Number.isFinite(op.cost) || op.cost < 1 || op.cost > 1000) throw new Error('cost: число 1–1000.');
    if (!Array.isArray(op.effects) || !op.effects.length || op.effects.length > 16) throw new Error('effects: 1–16 изменений.');
    const written = [];
    for (const effect of op.effects) {
      if (!object(effect) || Object.keys(effect).length !== 2 || !Object.hasOwn(effect, 'fact') || !['add', 'set'].some(k => Object.hasOwn(effect, k))) throw new Error('Эффект: fact и ровно одно из add/set.');
      validateCondition({ fact: effect.fact, exists: true }, 'effect');
      const path = parts(effect.fact);
      if (path.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('Защищённый путь эффекта.');
      if (written.some(p => p === effect.fact || p.startsWith(effect.fact + '/') || effect.fact.startsWith(p + '/'))) throw new Error('Эффекты не должны пересекаться.');
      written.push(effect.fact);
      if (Object.hasOwn(effect, 'add') ? !Number.isFinite(effect.add) : !primitive(effect.set)) throw new Error('Эффект add требует число, set — примитив JSON.');
    }
  }
  return operators;
}
export function projectFacts(observation, pointers) {
  return pointers.map(p => { const f = factAt(observation, p); return [p, f.found, f.found ? f.value : null]; });
}
export function knownCondition(c, observation) {
  return conditionFacts(c).every(p => factAt(observation, p).found);
}
export function applyOperator(observation, op) {
  if (!knownCondition(op.requires, observation) || !matches(op.requires, observation)) return null;
  const next = structuredClone(observation);
  for (const effect of op.effects) {
    const old = factAt(next, effect.fact);
    if (!old.found || !primitive(old.value)) return null;
    const value = Object.hasOwn(effect, 'add') ? (typeof old.value === 'number' ? old.value + effect.add : NaN) : effect.set;
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e9)) return null;
    if (effect.fact.startsWith('/inventory/') && (!Number.isSafeInteger(value) || value < 0)) return null;
    const path = parts(effect.fact); let parent = next;
    for (const key of path.slice(0, -1)) parent = parent[key];
    parent[path.at(-1)] = value;
  }
  return next;
}
export function validatePlan(proposal, context) {
  const p = jsonCopy(proposal);
  if (!object(p) || Object.keys(p).some(k => !['steps', 'reason'].includes(k)) || !Array.isArray(p.steps) || p.steps.length > 64 || !p.steps.every(id) || (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 500))) throw new Error('Planner: нужны steps (до 64 ID операторов) и необязательная reason (до 500 символов).');
  if (!knownCondition(context.goal.desired, context.observation)) throw new Error('Цель ссылается на неизвестный факт.');
  let predicted = context.observation;
  for (const name of p.steps) {
    const op = context.operators.find(o => o.id === name);
    if (!op || !context.skills.includes(op.action.skill)) throw new Error(`Planner выбрал недоступный оператор: ${name}.`);
    predicted = applyOperator(predicted, op);
    if (!predicted) throw new Error(`Не выполнены предпосылки или неизвестны факты оператора ${name}.`);
  }
  if (p.steps.length && !matches(context.goal.desired, predicted)) throw new Error('Предложенный план не достигает цели в модели.');
  return { steps: p.steps, reason: p.reason || (p.steps.length ? 'План проверен по модели действий.' : 'План не найден.') };
}

export function buildPlannerContext({ observation, goal, operators, skills }) {
  const context = jsonCopy({ perceptionVersion: observation.perceptionVersion ?? null, observation, goal, operators: validateOperators(operators), skills });
  if (!object(context.observation) || !object(context.goal) || !id(context.goal.id) || !Array.isArray(context.skills) || !context.skills.every(id)) throw new Error('Некорректный контекст Planner.');
  validateCondition(context.goal.desired, 'goal.desired');
  return context;
}

export function createSymbolicPlanner({ maxDepth = 16, maxNodes = 2000 } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 10000) throw new Error('maxDepth: 1–64, maxNodes: 1–10000.');
  return Object.freeze({ id: 'mckudo:symbolic', apiVersion: 1,
    async plan(context, { signal }) {
      signal.throwIfAborted();
      const { goal, observation, operators, skills } = context;
      if (!knownCondition(goal.desired, observation)) throw new Error('Цель ссылается на неизвестный факт.');
      if (matches(goal.desired, observation)) return { steps: [], reason: 'Цель уже достигнута.' };
      const available = operators.filter(o => skills.includes(o.action.skill));
      const pointers = [...new Set([...conditionFacts(goal.desired), ...available.flatMap(o => [...conditionFacts(o.requires), ...o.effects.map(e => e.fact)])])].sort();
      // Search only over relevant facts; large entity lists do not multiply search memory.
      const seed = {};
      for (const pointer of pointers) {
        const f = factAt(observation, pointer); if (!f.found) continue;
        let parent = seed; const path = parts(pointer);
        if (path.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) continue;
        for (const key of path.slice(0, -1)) { if (!object(parent[key])) parent[key] = {}; parent = parent[key]; }
        parent[path.at(-1)] = structuredClone(f.value);
      }
      const key = state => JSON.stringify(projectFacts(state, pointers));
      // Depth belongs to the key: a cheaper long route must not hide a valid shorter one.
      const queue = [{ state: seed, steps: [], cost: 0 }], visited = new Map([[key(seed) + ':0', 0]]);
      let generated = 1, expanded = 0, bounded = false;
      while (queue.length) {
        if (++expanded % 64 === 0) await yieldTurn();
        signal.throwIfAborted();
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        if (matches(goal.desired, current.state)) return { steps: current.steps, reason: `План по модели: ${current.steps.length} действий, стоимость ${current.cost}, просмотрено ${expanded} состояний.` };
        if (current.steps.length >= maxDepth) { bounded = true; continue; }
        for (const op of available) {
          if (generated >= maxNodes) { bounded = true; break; }
          const next = applyOperator(current.state, op); if (!next || key(next) === key(current.state)) continue;
          const cost = current.cost + op.cost, k = key(next) + ':' + (current.steps.length + 1);
          if ((visited.get(k) ?? Infinity) <= cost) continue;
          visited.set(k, cost); generated++;
          queue.push({ state: next, steps: [...current.steps, op.id], cost });
        }
      }
      return { steps: [], reason: bounded ? 'План не найден в пределах бюджета поиска.' : 'Нет пути к цели с доступными операторами и фактами.' };
    }
  });
}
