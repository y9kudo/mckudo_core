import {createHash} from 'node:crypto';
import {jsonCopy, validateCondition} from './config.js';
import {matches} from './conditions.js';
import {knownCondition} from './planner.js';
import {validateScenario} from './scenario.js';
import {validateAgentProgram, createAgentProgram} from './agent-program.js';

const safeReplay = action => ['wait','look','navigate','goto'].includes(action?.skill);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const satisfied = (condition, o) => knownCondition(condition, o) && matches(condition, o);

export function validateTasks(input, {skills = []} = {}) {
  const tasks = jsonCopy(input, 'tasks', 100000, 48), ids = new Set();
  if (!Array.isArray(tasks) || tasks.length > 32) throw new Error('Queue: from 0 to 32 tasks.');
  for (const t of tasks) {
    if (!t || typeof t !== 'object') throw new Error('A task must be an object.');
    const allowed = ['id','title','type','mode','priority','dependsOn','requires','expected','priorityWhen','retry','timeoutMs','resumePolicy',t.type === 'action' ? 'action' : t.type === 'program' ? 'program' : 'scenario'];
    if (Object.keys(t).some(k => !allowed.includes(k)) || typeof t.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(t.id) || ids.has(t.id) || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 100) throw new Error('A unique task id and a title of at most 100 characters are required.');
    ids.add(t.id);
    if (t.mode !== undefined && !['sequential','parallel'].includes(t.mode)) throw new Error('mode: sequential or parallel.');
    if (t.priority !== undefined && (!Number.isInteger(t.priority) || t.priority < -100 || t.priority > 100)) throw new Error('priority: an integer -100–100.');
    if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) || t.dependsOn.length > 32 || new Set(t.dependsOn).size !== t.dependsOn.length || t.dependsOn.some(id => typeof id !== 'string'))) throw new Error('dependsOn: unique task ids.');
    if (t.requires !== undefined) validateCondition(t.requires, 'task.requires');
    if (t.expected !== undefined) { validateCondition(t.expected, 'task.expected'); if (t.type !== 'action') throw new Error('expected is supported on action tasks.'); }
    if (t.priorityWhen !== undefined) {
      if (!Array.isArray(t.priorityWhen) || t.priorityWhen.length > 8) throw new Error('priorityWhen: at most eight conditions.');
      for (const p of t.priorityWhen) {
        if (!p || Object.keys(p).some(k => !['condition','boost'].includes(k)) || !Number.isInteger(p.boost) || Math.abs(p.boost) > 100) throw new Error('priorityWhen requires a condition and integer boost -100–100.');
        validateCondition(p.condition, 'task.priorityWhen.condition');
      }
    }
    if (t.retry !== undefined && (!t.retry || Object.keys(t.retry).some(k => !['maxAttempts','delayMs'].includes(k)) || !Number.isInteger(t.retry.maxAttempts) || t.retry.maxAttempts < 1 || t.retry.maxAttempts > 16 || t.retry.delayMs !== undefined && (!Number.isInteger(t.retry.delayMs) || t.retry.delayMs < 0 || t.retry.delayMs > 60000))) throw new Error('retry: maxAttempts 1–16 and optional delayMs 0–60000.');
    if (t.timeoutMs !== undefined && (!Number.isInteger(t.timeoutMs) || t.timeoutMs < 100 || t.timeoutMs > 300000)) throw new Error('timeoutMs: 100–300000.');
    if (t.resumePolicy !== undefined && (t.type !== 'action' || !['manual','recheck'].includes(t.resumePolicy))) throw new Error('resumePolicy: manual or recheck, on action tasks.');
    if (t.type === 'program') t.program = validateAgentProgram(t.program, {skills});
    else if (t.type === 'scenario') t.scenario = validateScenario(t.scenario);
    else if (t.type === 'action') {
      if (!t.action || Object.keys(t.action).some(k => !['skill','args'].includes(k)) || !skills.includes(t.action.skill) || !t.action.args || typeof t.action.args !== 'object' || Array.isArray(t.action.args)) throw new Error('Action: known skill and object args.');
    } else throw new Error('Task type: action, scenario or program.');
  }
  // Include implicit sequential edges, so explicit dependencies cannot introduce a hidden deadlock.
  const edges = new Map(); let previous;
  for (const t of tasks) {
    const dependencies = new Set(t.dependsOn || []);
    if (t.mode !== 'parallel' && previous) dependencies.add(previous);
    if (t.mode !== 'parallel') previous = t.id;
    if ([...dependencies].some(id => !ids.has(id) || id === t.id)) throw new Error('Unknown or self-referencing task dependency.');
    edges.set(t.id, dependencies);
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error('Task dependency cycle.');
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of edges.get(id)) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return tasks;
}

/** Dependency scheduling and durable boundaries share one physical executor. */
export function createTaskQueue({tasks = [], skills = [], scenarioFactory, resume, checkpoint, clock = Date.now} = {}) {
  const definition = validateTasks(tasks, {skills}), definitionHash = hash(definition);
  if (checkpoint !== undefined && typeof checkpoint !== 'function') throw new Error('checkpoint must be an asynchronous callback.');
  if (resume && !Array.isArray(resume) && (resume.schemaVersion !== 1 || resume.definitionHash !== definitionHash || !Array.isArray(resume.tasks))) throw new Error('Task checkpoint belongs to a different definition or schema.');
  const saved = resume ? jsonCopy(Array.isArray(resume) ? resume : resume.tasks, 'taskCheckpoint', 1048576, 64) : [];
  if (saved.length > 32) throw new Error('Task checkpoint is too large.');
  const controllers = new Map(), states = definition.map(task => {
    const old = saved.find(s => s.id === task.id);
    if (old?.definitionHash && old.definitionHash !== definitionHash) throw new Error('Task checkpoint definition changed.');
    return {id:task.id, status:['completed','failed','blocked'].includes(old?.status) ? old.status : 'pending',
      reason:String(old?.reason || '').slice(0,500), failures:Number.isInteger(old?.failures) && old.failures >= 0 && old.failures <= 16 ? old.failures : 0,
      retryAt:Math.min(clock() + 60000, Math.max(0, Number(old?.retryAt) || 0)),
      uncertain:old?.uncertain === true || old?.status === 'running'};
  });
  let active = null, lastSelected = -1, proposed = null, persistenceError = '';
  const controllerFor = (task, index) => {
    if (!controllers.has(task.id)) {
      const old = saved.find(s => s.id === task.id);
      if (task.type === 'program') controllers.set(task.id, createAgentProgram({program:task.program, skills, scenarioFactory, resume:old?.program}));
      else {
        if (!scenarioFactory) throw new Error('Scenario tasks require scenarioFactory.');
        controllers.set(task.id, scenarioFactory(task.scenario, old?.scenario));
      }
    }
    return controllers.get(task.id);
  };
  const snapshot = () => jsonCopy(states.map((state, index) => {
    const task = definition[index], c = controllers.get(task.id), old = saved.find(s => s.id === task.id);
    return {...state, definitionHash,
      ...(task.type === 'program' ? {program:c?.snapshot() || old?.program || null} : {}),
      ...(task.type === 'scenario' && (c?.exportMemory || old?.scenario) ? {scenario:c?.exportMemory?.() || old.scenario} : {})};
  }), 'taskState', 1048576, 64);
  const exportCheckpoint = () => ({schemaVersion:1, definitionHash, tasks:snapshot()});
  const persist = async () => {
    try { await checkpoint?.(exportCheckpoint()); }
    catch (error) { persistenceError = String(error.message).slice(0,400); throw error; }
  };
  const reactor = {
    id:'overmind:tasks', apiVersion:1, managesRetries:true,
    async beforeAction({signal}) { signal.throwIfAborted(); await persist(); signal.throwIfAborted(); },
    async afterAction() { await persist(); },
    react(o) {
      if (persistenceError) return {action:null, reason:'Checkpoint failed: ' + persistenceError};
      if (active) return {action:null, reason:'Waiting for the current action to settle.'};
      proposed = null;
      const firstSequential = definition.findIndex((t,i) => t.mode !== 'parallel' && states[i].status !== 'completed'), choices = [];
      for (let i = 0; i < definition.length; i++) {
        const task = definition[i], state = states[i];
        if (state.status === 'completed' || task.mode !== 'parallel' && i !== firstSequential) continue;
        if (state.status === 'failed' && !state.uncertain) continue;
        const waiting = (task.dependsOn || []).filter(id => states.find(s => s.id === id).status !== 'completed');
        if (waiting.length) { state.status = 'blocked'; state.reason = 'Waiting for dependencies: ' + waiting.join(', '); continue; }
        if (state.uncertain) {
          if (task.type === 'action' && task.expected && satisfied(task.expected, o)) { state.status = 'completed'; state.uncertain = false; state.reason = 'Interrupted action confirmed by fresh observations.'; continue; }
          if (state.status === 'failed') continue;
          if (task.type === 'action' && !(task.resumePolicy === 'recheck' || task.resumePolicy === undefined && safeReplay(task.action))) {
            state.status = 'blocked'; state.reason = 'Interrupted action has an unknown outcome; observe its expected condition or explicitly retry.'; continue;
          }
          state.uncertain = false; state.status = 'pending';
        }
        if (state.retryAt > clock()) { state.status = 'blocked'; state.reason = 'Retry backoff until ' + state.retryAt; continue; }
        if (task.requires && !satisfied(task.requires, o)) { state.status = 'blocked'; state.reason = 'Required resources or observed facts are missing or unsatisfied.'; continue; }
        let decision;
        if (task.type === 'action') decision = {action:task.action, priority:20, reason:task.title, ...(task.expected ? {expected:task.expected} : {})};
        else {
          const controller = controllerFor(task, i); decision = controller.reactor.react(o);
          const child = controller.snapshot();
          if (child.status === 'completed') { state.status = 'completed'; state.reason = ''; continue; }
          if (child.status === 'failed') { state.status = 'failed'; state.reason = child.reason; continue; }
        }
        state.status = decision.action ? 'pending' : 'blocked'; state.reason = String(decision.reason || '').slice(0,500);
        if (decision.action) {
          const base = decision.priority ?? 20, boost = Math.max(-100,Math.min(100,(task.priority || 0)+(task.priorityWhen || []).reduce((n,p)=>n+(satisfied(p.condition,o)?p.boost:0),0)));
          choices.push({index:i, decision, priority:base>=900?base:Math.max(-1000,Math.min(899,base+boost))});
        }
      }
      if (!choices.length) return {action:null, reason:states.find(s => s.status === 'failed' || s.status === 'blocked')?.reason || 'All tasks completed.'};
      choices.sort((a,b) => b.priority - a.priority || ((a.index-lastSelected+definition.length)%definition.length) - ((b.index-lastSelected+definition.length)%definition.length));
      const selected = choices[0]; lastSelected = selected.index; proposed = selected.index;
      return {...selected.decision, priority:selected.priority, ...(definition[selected.index].timeoutMs ? {timeoutMs:definition[selected.index].timeoutMs} : {})};
    }
  };
  return {
    reactor, definition:() => jsonCopy(definition,'tasks',100000,48), snapshot, checkpoint:exportCheckpoint,
    retry(id) {
      if (active) throw new Error('First stop the current action.');
      const state = states.find(s => s.id === id); if (!state) throw new Error('Unknown task.');
      Object.assign(state,{status:'pending',reason:'',failures:0,retryAt:0,uncertain:false});
      controllers.delete(id); const old = saved.findIndex(s => s.id === id); if (old >= 0) saved.splice(old,1);
      persistenceError = '';
    },
    attach(brain) {
      const start = e => {
        if (e.id !== reactor.id || proposed === null || active) return;
        const index = proposed; proposed = null; states[index].status = 'running'; states[index].uncertain = true;
        active = {index, action:e.action}; controllers.get(definition[index].id)?.beginAction?.();
      };
      const finish = e => {
        if (e.rule !== reactor.id || !active) return;
        const {index, action} = active; active = null;
        const state = states[index], task = definition[index];
        controllers.get(task.id)?.recordResult?.(e, action);
        state.uncertain = false;
        if (e.outcome === 'success') { state.failures = 0; state.status = task.type === 'action' ? 'completed' : 'pending'; state.reason = ''; }
        else if (e.outcome === 'failure') {
          state.failures++; const maximum = task.retry?.maxAttempts ?? (task.type === 'action' ? 1 : 6);
          state.status = state.failures < maximum ? 'blocked' : 'failed'; state.reason = String(e.detail || 'Action failed.').slice(0,500);
          state.retryAt = clock() + (task.retry?.delayMs || 0);
          if (task.type === 'action' && !safeReplay(action)) state.uncertain = true;
        } else {
          state.status = 'pending';
          if (task.type === 'action' && !safeReplay(action)) state.uncertain = true;
        }
      };
      brain.on('action:start',start); brain.on('action:finish',finish);
      return () => { brain.off('action:start',start); brain.off('action:finish',finish); };
    }
  };
}
