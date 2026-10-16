import { setImmediate as yieldTurn } from 'node:timers/promises';
import { applyOperator, conditionFacts, projectFacts, validatePlan,knownCondition } from './planner.js';
import { factAt } from './conditions.js';
import { matches } from './conditions.js';

class Frontier {
  items = []; serial = 0;
  push(value) { const a = this.items, v = { ...value, serial: this.serial++ }; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (this.compare(a[p], v) <= 0) break; a[i] = a[p]; i = p; } a[i] = v; }
  compare(a, b) { return a.cost - b.cost || a.serial - b.serial; }
  pop() { const a = this.items, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && this.compare(a[c + 1], a[c]) < 0) c++; if (this.compare(a[c], last) >= 0) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
}

/** Retain a validated suffix and find a short connector; predictions never execute actions. */
export async function repairPlan(context, previousSteps, { maxNodes = 128, maxDepth = 4, maxSuffixes = 8, signal } = {}) {
  if (!Array.isArray(previousSteps) || previousSteps.length > 64 || previousSteps.some(s => typeof s !== 'string') || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096 || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16 || !Number.isInteger(maxSuffixes) || maxSuffixes < 1 || maxSuffixes > 16) throw new Error('Plan repair budgets are invalid.');
  signal?.throwIfAborted();
  if(!knownCondition(context.goal.desired,context.observation))throw new Error('Repair goal refers to an unknown fact.');
  const byId = new Map(context.operators.map(op => [op.id, op])), suffixes = [];
  for (let offset = 0; offset < Math.min(previousSteps.length, maxSuffixes); offset++) {
    const steps = previousSteps.slice(offset); if (steps.every(id => byId.has(id))) suffixes.push({ steps, offset });
  }
  if(matches(context.goal.desired,context.observation))return {status:'repaired',steps:[],retainedSteps:0,replacedSteps:previousSteps.length,connectorSteps:0,visited:0,generated:0,reason:'Goal already confirmed by the current observation.'};
  if(!suffixes.length)return {status:'blocked',steps:[],retainedSteps:0,replacedSteps:0,connectorSteps:0,visited:0,generated:0,reason:'No available cached suffix to retain.'};
  const pointers = [...new Set([...conditionFacts(context.goal.desired), ...context.operators.flatMap(op => [...conditionFacts(op.requires), ...op.effects.map(e => e.fact)])])].sort();
  const signature = state => JSON.stringify(projectFacts(state, pointers));
  const seed={};for(const pointer of pointers){const f=factAt(context.observation,pointer);if(!f.found)continue;const parts=pointer.slice(1).split('/').map(v=>v.replace(/~1/g,'/').replace(/~0/g,'~'));if(parts.some(k=>['__proto__','prototype','constructor'].includes(k)))continue;let parent=seed;for(const k of parts.slice(0,-1)){if(!parent[k]||typeof parent[k]!=='object')parent[k]={};parent=parent[k];}parent[parts.at(-1)]=structuredClone(f.value);}
  const queue = new Frontier(), seen = new Map(), root = { state: seed, steps: [], cost: 0 };
  queue.push(root); seen.set(signature(root.state)+':0', 0); let visited = 0, generated = 1;
  while (queue.items.length && visited < maxNodes) {
    if (visited % 16 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
    const node = queue.pop(),nodeKey=signature(node.state); if (node.cost !== seen.get(nodeKey+':'+node.steps.length)) continue; visited++;
    let retained=null;
    for (const suffix of suffixes) {
      try {
        const plan = validatePlan({ steps: suffix.steps, reason: 'Retained a valid plan suffix.' }, { ...context, observation: node.state });
        const steps = [...node.steps, ...plan.steps]; if (steps.length > 64) continue;
        validatePlan({ steps }, context); signal?.throwIfAborted();
        const cost=suffix.steps.reduce((n,id)=>n+byId.get(id).cost,0);
        if(!retained||cost<retained.cost)retained={cost,steps,suffix};
      } catch (error) { signal?.throwIfAborted(); }
    }
    if(retained)return {status:'repaired',steps:retained.steps,retainedSteps:retained.suffix.steps.length,replacedSteps:retained.suffix.offset,connectorSteps:node.steps.length,visited,generated,reason:`Repaired with ${node.steps.length} connector actions; retained ${retained.suffix.steps.length} steps.`};
    if (node.steps.length >= maxDepth || generated >= maxNodes) continue;
    for (let index = 0; index < context.operators.length; index++) {
      if (index && index % 64 === 0) { await yieldTurn(); signal?.throwIfAborted(); }
      if (generated >= maxNodes) break;
      const op = context.operators[index]; if (!context.skills.includes(op.action.skill)) continue;
      const next = applyOperator(node.state, op); if (!next) continue;
      const nextKey=signature(next);if(nextKey===nodeKey)continue;
      const key = nextKey+':'+(node.steps.length+1), cost = node.cost + op.cost;
      if ((seen.get(key) ?? Infinity) <= cost) continue;
      seen.set(key, cost); generated++; queue.push({ state: next, steps: [...node.steps, op.id], cost });
    }
  }
  return { status: 'blocked', steps: [], retainedSteps: 0, connectorSteps: 0, replacedSteps: 0, visited, generated, reason: 'No repair within the connector budget; full replanning is required.' };
}
