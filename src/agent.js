import { setTimeout as delay } from 'node:timers/promises';
import { createAgentManager } from './agent-manager.js';
import { validateScenario } from './scenario.js';
import { defineMission } from './mission.js';
import {validateAgentProgram} from './agent-program.js';

/** A small application facade. Planning and execution still belong to the reusable core/client. */
export function createMinecraftAgent({ name = 'Atlas', worldId, connection = {}, memoryDirectory, brainOptions = {}, createClient, createBrain } = {}) {
  if (typeof worldId !== 'string' || !worldId.trim()) throw new Error("Show me the constant worldId to remember this world.");
  const manager = createAgentManager({ count: 1, names: [name], worldId, connection, memoryDirectory, brainOptions, createClient, createBrain });
  let connecting, active, closing, closed = false;
  const entry = () => manager.entries.get(name);
  const ensureOpen = () => { if (closed) throw new Error("Agent closed. Create a new instance."); };
  const snapshot = () => manager.snapshot().agents[0];
  const connect = async () => {
    ensureOpen();
    if (!connecting) connecting = manager.execute(name, 'connect').finally(() => { connecting = null; });
    await connecting;
    ensureOpen();
    if (entry().client.state.status !== 'ready') throw new Error("Agent isn't ready: Check the connection and health.");
    return snapshot();
  };
  const cancel = reason => {
    active?.controller.abort(reason);
    entry().client.pending?.abort.abort(reason);
  };
  const pause = async () => {
    cancel(new Error("Scenario stopped by user."));
    if (active) await active.promise.catch(() => {});
    if (!closed) await manager.execute(name, 'pause');
  };
  const api = {
    name, worldId, manager, get client() { return entry().client; }, snapshot, connect, pause,
    mission(steps,options) { return api.run(defineMission(steps),options); },
    get(item,count=1,options) { return api.mission([{get:item,count}],options); },
    craft(item,count=1,options) { return api.mission([{craft:item,count}],options); },
    goTo(position,{range=1,bridge=true,excavate=false,...options}={}) { return api.mission([{go:position,range,bridge,excavate}],options); },
    swimTo(position,options) { return api.mission([{swim:position}],options); },
    runProgram(program,options) { return api.run(program,{...options,program:true}); },
    async start(goal = 'wood') {
      ensureOpen();
      if (active) throw new Error("First stop the script.");
      if (!['wood', 'stone_tools', 'iron_pickaxe', 'diamond_set'].includes(goal)) throw new Error("Unknown Goal of Survival.");
      await connect();
      await manager.execute(name, 'goal', { target: goal });
      await manager.execute(name, 'start');
      return snapshot();
    },
    run(input, { timeoutMs = 300000, signal,program=false } = {}) {
      ensureOpen();
      if (active) throw new Error("One agent does one script. Wait till you're finished or call pause().");
      const scenario = program?validateAgentProgram(input,{skills:entry().client.describe().skills}):validateScenario(input);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error("timeoutMs: from 1000 to 1800000 ms.");
      signal?.throwIfAborted();
      const controller = new AbortController(), run = { controller, promise: null };
      active = run;
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        const reason=entry().queue?.snapshot().find(t=>t.status!=='completed')?.reason;
        controller.abort(new Error("The scenario time has expired."+(reason?" Final phase: "+reason:'')));
      }, timeoutMs);
      // Closing an unfinished handshake also interrupts connect(), not just skill execution.
      const interrupt = () => {
        entry().client.pending?.abort.abort(controller.signal.reason);
        if (entry().client.state.status === 'connecting') void entry().client.close().catch(() => {});
      };
      controller.signal.addEventListener('abort', interrupt, { once: true });
      run.promise = (async () => {
        try {
          await connect(); controller.signal.throwIfAborted();
          await manager.execute(name, 'tasks', { tasks: [program?{id:'program',title:scenario.name,type:'program',program:scenario}:{ id: 'scenario', title: scenario.name, type: 'scenario', scenario }] });
          controller.signal.throwIfAborted();
          await manager.execute(name, 'start');
          while (true) {
            controller.signal.throwIfAborted();
            const e = entry(), state = e.queue.snapshot();
            if (e.client.state.status !== 'ready' || e.client.state.health != null && e.client.state.health <= 0) throw new Error("Agent died or disconnected. The scenario is incomplete.");
            if (state.length && state.every(t => t.status === 'completed')) break;
            const failed = state.find(t => t.status === 'failed');
            if (failed) throw new Error(failed.reason || "The script ended with a mistake.");
            await delay(100, undefined, { signal: controller.signal });
          }
        } catch (error) {
          controller.signal.throwIfAborted(); throw error;
        } finally {
          clearTimeout(timer); signal?.removeEventListener('abort', abort);
          controller.signal.removeEventListener('abort', interrupt);
          try { await manager.execute(name, 'pause'); } finally { if (active === run) active = null; }
        }
        return snapshot();
      })();
      return run.promise;
    },
    async respawn() { ensureOpen(); await pause(); await manager.execute(name, 'respawn'); return snapshot(); },
    close() {
      if (!closing) {
        closed = true; cancel(new Error("Agent closes."));
        if (entry().client.state.status === 'connecting') void entry().client.close().catch(() => {});
        closing = (async () => { await active?.promise.catch(() => {}); await connecting?.catch(() => {}); await manager.close(); })();
      }
      return closing;
    }
  };
  return api;
}
