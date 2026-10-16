import { setImmediate as yieldTurn } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createSymbolicPlanner, validatePlan, applyOperator } from './planner.js';
import { jsonCopy, id } from './config.js';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const actionKey = a => JSON.stringify(canonical({ skill: a.skill, args: a.args || {} }));
const plannerOK = p => id(p?.id) && p.apiVersion === 1 && typeof p.plan === 'function';

/** Select only completely validated symbolic proposals; no provider receives an executor. */
export function createCognitivePlanner({ planners = [createSymbolicPlanner()], assess, budgetMs = 100, clock = () => performance.now() } = {}) {
  if (!Array.isArray(planners) || !planners.length || planners.length > 4 || planners.some(p => !plannerOK(p)) || new Set(planners.map(p => p.id)).size !== planners.length || assess !== undefined && typeof assess !== 'function' || !Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 10000 || typeof clock !== 'function') throw new Error('Cognitive planner requires 1–4 unique planners and a bounded time budget.');
  let busy = false, calls = 0, snapshot = { choices: [], rejected: [], selected: null, elapsedMs: 0, budgetExpired: false };
  return {
    id: 'overmind:cognitive-planner', apiVersion: 1,
    async plan(context, { signal } = {}) {
      signal?.throwIfAborted(); if (busy) throw new Error('Cognitive planner already has a request.'); busy = true; calls++;snapshot={choices:[],rejected:[],selected:null,elapsedMs:0,budgetExpired:false};
      const started = clock(), deadline = new AbortController(), abort = () => deadline.abort(signal.reason);
      const timer = setTimeout(() => deadline.abort(new Error('Cognitive planning budget expired.')), budgetMs);
      signal?.addEventListener('abort', abort, { once: true });
      const choices = [], rejected = [];
      try {
        for (const provider of planners) {
          signal?.throwIfAborted(); if (deadline.signal.aborted || clock() - started >= budgetMs) break;
          await yieldTurn();
          try {
            const proposal = await provider.plan(jsonCopy(context, 'plannerContext', 4 * 1024 * 1024), { signal: deadline.signal });
            signal?.throwIfAborted(); if (deadline.signal.aborted) break;
            const plan = validatePlan(proposal, context); if (!plan.steps.length) { rejected.push({ provider: provider.id, reason: plan.reason }); continue; }
            let state = context.observation, baseCost = 0, learnedCost = 0, uncertain = 0;
            for (let i = 0; i < plan.steps.length; i++) {
              if (i % 8 === 0) { await yieldTurn(); signal?.throwIfAborted(); deadline.signal.throwIfAborted(); }
              const op = context.operators.find(op => op.id === plan.steps[i]); baseCost += op.cost;
              if (assess) {
                const e = assess(state, op.action);
                if (!e || typeof e.trained!=='boolean' || !Number.isFinite(e.cost) || e.cost < 0 || e.cost > 1000 || e.uncertainty !== undefined && (!Number.isFinite(e.uncertainty) || e.uncertainty < 0 || e.uncertainty > 1)) throw new Error('Invalid learned planning cost.');
                if (e.trained && (e.uncertainty ?? 0) < .75) learnedCost += e.cost; else uncertain++;
              }
              state = applyOperator(state, op);
            }
            choices.push({ provider: provider.id, steps: plan.steps, reason: plan.reason, baseCost, learnedCost, uncertain, cost: baseCost + learnedCost });
          } catch (error) {
            signal?.throwIfAborted(); rejected.push({ provider: provider.id, reason: String(error.message).slice(0, 250) });
            if (deadline.signal.aborted) break;
          }
        }
        signal?.throwIfAborted(); choices.sort((a, b) => a.cost - b.cost);
        const best = choices[0];
        snapshot = { choices, rejected, selected: best?.provider || null, elapsedMs: Math.max(0, clock() - started), budgetExpired: deadline.signal.aborted || clock() - started >= budgetMs };
        return best ? { steps: [...best.steps], reason: `${best.provider}: ${best.steps.length} validated steps, estimated cost ${best.cost.toFixed(2)}.` } : { steps: [], reason: snapshot.budgetExpired ? 'No validated proposal within the planning budget.' : 'Every proposal was blocked or rejected by the action model.' };
      } finally { if(signal?.aborted)snapshot={choices:[],rejected:[{provider:'request',reason:'Planning cancelled.'}],selected:null,elapsedMs:Math.max(0,clock()-started),budgetExpired:false};clearTimeout(timer); signal?.removeEventListener('abort', abort); busy = false; }
    },
    snapshot: () => jsonCopy({ ...snapshot, busy, calls })
  };
}

function operatorFor(action, context) {
  const matches = context.operators.filter(op => actionKey(op.action) === actionKey(action) && context.skills.includes(op.action.skill));
  if (matches.length !== 1) throw new Error('Action proposal must resolve to exactly one available operator.');
  return matches[0];
}

/** Adapt the existing HTN implementation; methods/primitives remain application-owned. */
export function createHTNPlannerAdapter({ planner, tasks, id: providerId = 'overmind:htn-adapter' } = {}) {
  if (typeof planner?.plan !== 'function' || typeof tasks !== 'function' || !id(providerId)) throw new Error('HTN adapter requires a planner and tasks(context).');
  return { id: providerId, apiVersion: 1, async plan(context, { signal } = {}) {
    signal?.throwIfAborted(); const result = await planner.plan(tasks(structuredClone(context)), structuredClone(context.observation), { signal });
    signal?.throwIfAborted(); if (result.status !== 'planned') return { steps: [], reason: 'HTN decomposition did not produce a complete plan.' };
    if (!Array.isArray(result.actions) || result.actions.length > 64) throw new Error('HTN action proposal exceeds 64 steps.');
    return validatePlan({ steps: result.actions.map(a => operatorFor(a, context).id), reason: 'Validated HTN decomposition.' }, context);
  } };
}

/** MCTS proposes one modeled action; symbolic completion must still reach the modeled goal. */
export function createMCTSPlannerAdapter({ planner, completion = createSymbolicPlanner(), id: providerId = 'overmind:mcts-adapter' } = {}) {
  if (typeof planner?.plan !== 'function' || !plannerOK(completion) || !id(providerId)) throw new Error('MCTS adapter requires a planner and a completion planner.');
  return { id: providerId, apiVersion: 1, async plan(context, { signal } = {}) {
    signal?.throwIfAborted(); const proposed = await planner.plan(structuredClone(context.observation), { signal });
    signal?.throwIfAborted(); if (proposed.status !== 'planned' || !proposed.action) return { steps: [], reason: 'MCTS did not propose a modeled action.' };
    const op = operatorFor(proposed.action, context), next = applyOperator(context.observation, op); if (!next) throw new Error('MCTS proposal is inapplicable to known facts.');
    const tail = await completion.plan({ ...structuredClone(context), observation: next }, { signal });
    signal?.throwIfAborted(); return validatePlan({ steps: [op.id, ...tail.steps], reason: 'Validated MCTS prefix and symbolic completion.' }, context);
  } };
}
