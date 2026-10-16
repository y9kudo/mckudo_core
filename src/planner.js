import { setImmediate as yieldTurn } from 'node:timers/promises';
import { jsonCopy, object, id, validateCondition } from './config.js';
import { factAt, matches } from './conditions.js';

const primitive = x => x === null || ['string', 'number', 'boolean'].includes(typeof x);
const parts = p => p.slice(1).split('/').map(v => v.replace(/~1/g, '/').replace(/~0/g, '~'));
class CostFrontier {
  values=[];serial=0;
  push(value){const v={...value,order:this.serial++},a=this.values;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(this.compare(a[p],v)<=0)break;a[i]=a[p];i=p;}a[i]=v;}
  compare(a,b){return a.cost-b.cost||a.order-b.order;}
  pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.compare(a[c+1],a[c])<0)c++;if(this.compare(a[c],last)>=0)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
  get length(){return this.values.length;}
}
/** Backward causal slicing retains every producer of a needed fact and its prerequisites. */
function relevantOperators(operators,desired){
  const producers=new Map();for(const op of operators)for(const e of op.effects){if(!producers.has(e.fact))producers.set(e.fact,[]);producers.get(e.fact).push(op);}
  const facts=new Set(conditionFacts(desired)),queue=[...facts],selected=new Set();
  for(let i=0;i<queue.length;i++)for(const op of producers.get(queue[i])||[]){if(selected.has(op.id))continue;selected.add(op.id);for(const fact of conditionFacts(op.requires))if(!facts.has(fact)){facts.add(fact);queue.push(fact);}}
  return operators.filter(op=>selected.has(op.id));
}
export function conditionFacts(c) {
  if (!c) return [];
  if (c.all || c.any) return (c.all || c.any).flatMap(conditionFacts);
  return c.not ? conditionFacts(c.not) : [c.fact];
}
export function validateOperators(input) {
  const operators = jsonCopy(input,'operators',4*1024*1024);
  if (!Array.isArray(operators) || !operators.length || operators.length > 2048) throw new Error('Requires 1–2048 planning operators.');
  const names = new Set();
  for (const op of operators) {
    if (!object(op) || Object.keys(op).some(k => !['id', 'action', 'requires', 'effects', 'cost'].includes(k)) || !id(op.id) || names.has(op.id)) throw new Error("The operator needs a unique id and permitted fields.");
    names.add(op.id);
    if (!object(op.action) || Object.keys(op.action).some(k => !['skill', 'args'].includes(k)) || !id(op.action.skill)) throw new Error(`Operator ${op.id}: Wrong action.`);
    if (op.action.args === undefined) op.action.args = {};
    if (!object(op.action.args)) throw new Error(`Operator ${op.id}: args must be the object.`);
    if (op.requires !== undefined) validateCondition(op.requires, `operators.${op.id}.requires`);
    if (op.cost === undefined) op.cost = 1;
    if (!Number.isFinite(op.cost) || op.cost < 1 || op.cost > 1000) throw new Error("cost: number 1–1000.");
    if (!Array.isArray(op.effects) || !op.effects.length || op.effects.length > 16) throw new Error("effects: 1–16 changes.");
    const written = [];
    for (const effect of op.effects) {
      if (!object(effect) || Object.keys(effect).length !== 2 || !Object.hasOwn(effect, 'fact') || !['add', 'set'].some(k => Object.hasOwn(effect, k))) throw new Error("Effect: fact And one of the two (of the two) add/set.");
      validateCondition({ fact: effect.fact, exists: true }, 'effect');
      const path = parts(effect.fact);
      if (path.some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error("Protected effect path.");
      if (written.some(p => p === effect.fact || p.startsWith(effect.fact + '/') || effect.fact.startsWith(p + '/'))) throw new Error("Effects should not overlap.");
      written.push(effect.fact);
      if (Object.hasOwn(effect, 'add') ? !Number.isFinite(effect.add) : !primitive(effect.set)) throw new Error("Effect add requires number, set — Primitive JSON.");
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
  if (!object(p) || Object.keys(p).some(k => !['steps', 'reason'].includes(k)) || !Array.isArray(p.steps) || p.steps.length > 64 || !p.steps.every(id) || (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 500))) throw new Error("Planner: requires steps (to 64 ID operators) non-binding reason (to 500 characters).");
  if (!knownCondition(context.goal.desired, context.observation)) throw new Error("The purpose refers to an unknown fact.");
  let predicted = context.observation;
  for (const name of p.steps) {
    const op = context.operators.find(o => o.id === name);
    if (!op || !context.skills.includes(op.action.skill)) throw new Error(`Planner selected an inaccessible operator: ${name}.`);
    predicted = applyOperator(predicted, op);
    if (!predicted) throw new Error(`The premises or unknown facts of the operator have not been met ${name}.`);
  }
  if (p.steps.length && !matches(context.goal.desired, predicted)) throw new Error("The proposed plan does not meet the model target.");
  return { steps: p.steps, reason: p.reason || (p.steps.length ? "The plan is tested by the model of action." : "No plan found.") };
}

export function buildPlannerContext({ observation, goal, operators, skills }) {
  const context = jsonCopy({ perceptionVersion: observation.perceptionVersion ?? null, observation, goal, operators: validateOperators(operators), skills },'plannerContext',4*1024*1024);
  if (!object(context.observation) || !object(context.goal) || !id(context.goal.id) || !Array.isArray(context.skills) || !context.skills.every(id)) throw new Error("Uncorrect context Planner.");
  validateCondition(context.goal.desired, 'goal.desired');
  return context;
}

export function createSymbolicPlanner({ maxDepth = 16, maxNodes = 2000 } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000) throw new Error('maxDepth: 1–64, maxNodes: 1–100000.');
  let stats={operators:0,relevantOperators:0,expanded:0,generated:0};
  return Object.freeze({ id: 'overmind:symbolic', apiVersion: 1,
    snapshot:()=>({...stats}),
    async plan(context, { signal }) {
      signal.throwIfAborted();
      const { goal, observation, operators, skills } = context;
      if (!knownCondition(goal.desired, observation)) throw new Error("The purpose refers to an unknown fact.");
      if (matches(goal.desired, observation)) return { steps: [], reason: "Target already achieved." };
      const available = relevantOperators(operators.filter(o => skills.includes(o.action.skill)),goal.desired);
      stats={operators:operators.length,relevantOperators:available.length,expanded:0,generated:1};
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
      const queue = new CostFrontier(), visited = new Map([[key(seed) + ':0', 0]]);queue.push({state:seed,steps:[],cost:0});
      let generated = 1, expanded = 0, bounded = false;
      while (queue.length) {
        if (++expanded % 64 === 0) await yieldTurn();
        signal.throwIfAborted();
        const current = queue.pop();stats.expanded=expanded;stats.generated=generated;
        if(current.cost!==(visited.get(key(current.state)+':'+current.steps.length)??Infinity))continue;
        if (matches(goal.desired, current.state)) return { steps: current.steps, reason: `Model plan: ${current.steps.length} actions, value ${current.cost}, reviewed ${expanded} State.` };
        if (current.steps.length >= maxDepth) { bounded = true; continue; }
        for (let index=0;index<available.length;index++) {
          if(index&&index%128===0){await yieldTurn();signal.throwIfAborted();}
          const op=available[index];
          if (generated >= maxNodes) { bounded = true; break; }
          const next = applyOperator(current.state, op); if (!next || key(next) === key(current.state)) continue;
          const cost = current.cost + op.cost, k = key(next) + ':' + (current.steps.length + 1);
          if ((visited.get(k) ?? Infinity) <= cost) continue;
          visited.set(k, cost); generated++;
          queue.push({ state: next, steps: [...current.steps, op.id], cost });
        }
      }
      return { steps: [], reason: bounded ? "Plan not found within the search budget." : "No way to reach a target with accessible operators and facts." };
    }
  });
}
