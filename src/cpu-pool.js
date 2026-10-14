import { Worker } from 'node:worker_threads';
import { AsyncResource } from 'node:async_hooks';
import { availableParallelism } from 'node:os';

/** Reused CPU workers. No sockets, controls, credentials or arbitrary code enter this pool. */
export function createCpuPool({ workers = 1, maxQueue = 16, memoryMb = 96, timeoutMs = 15000 } = {}) {
  if (!Number.isInteger(workers) || workers < 1 || workers > Math.min(2, availableParallelism()) || !Number.isInteger(maxQueue) || maxQueue < 1 || maxQueue > 128 || !Number.isInteger(memoryMb) || memoryMb < 32 || memoryMb > 256 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error("CPU: workers 1–2 (not more than available CPU), maxQueue 1–128, memoryMb 32–256, timeoutMs 100–60000.");
  const slots = [], queue = [], jobs = new Set();
  let closed = false, sequence = 0;
  const stats = { completed: 0, failed: 0, cancelled: 0, restarts: 0 };
  const finish = (job, error, value) => {
    if (!jobs.delete(job)) return;
    clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
    const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1);
    job.resource.runInAsyncScope(error ? job.reject : job.resolve, null, error || value);
    job.resource.emitDestroy();
  };
  const replace = slot => {
    if (slot.retiring) return;
    slot.retiring = true; slot.worker.removeAllListeners('message');
    slot.worker.terminate().finally(() => { const i = slots.indexOf(slot); if (i >= 0) slots.splice(i, 1); if (!closed) pump(); });
  };
  const fail = (slot, error) => {
    if (slot.retiring) return;
    if (slot.job) { stats.failed++; finish(slot.job, error); slot.job = null; }
    stats.restarts++; replace(slot);
  };
  const spawn = () => {
    const slot = { worker: new Worker(new URL('./exploration-worker.js', import.meta.url), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 } }), job: null, retiring: false };
    slots.push(slot);
    slot.worker.on('message', message => {
      const job = slot.job;
      if (!job || message.id !== job.id) return;
      slot.job = null; slot.worker.unref();
      if (message.error) { stats.failed++; finish(job, new Error(message.error)); }
      else { stats.completed++; finish(job, null, message.result); }
      pump();
    });
    slot.worker.on('error', error => fail(slot, error));
    slot.worker.on('exit', code => { if (!slot.retiring && !closed) fail(slot, new Error(`CPU worker completed: ${code}.`)); });
    slot.worker.unref(); return slot;
  };
  function pump() {
    if (closed) return;
    while (queue.length) {
      let slot = slots.find(s => !s.retiring && !s.job);
      if (!slot && slots.length < workers) slot = spawn();
      if (!slot) break;
      const job = queue.shift(); slot.job = job; job.slot = slot; slot.worker.ref();
      try { slot.worker.postMessage({ id: job.id, input: job.input }); }
      catch (error) { slot.job = null; slot.worker.unref(); stats.failed++; finish(job, error); }
    }
  }
  return {
    run(input, { signal } = {}) {
      if (closed || jobs.size >= maxQueue) return Promise.reject(new Error(closed ? "CPU pool closed." : "Queue CPU full."));
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const job = { id: ++sequence, input, signal, resolve, reject, resource: new AsyncResource('OvermindMCCpuJob') };
        job.abort = () => { if (!jobs.has(job)) return; stats.cancelled++; finish(job, signal.reason); if (job.slot?.job === job) { job.slot.job = null; replace(job.slot); } else pump(); };
        job.timer = setTimeout(() => { if (!jobs.has(job)) return; stats.failed++; finish(job, new Error("The calculation budget has expired CPU.")); if (job.slot?.job === job) { job.slot.job = null; replace(job.slot); } else pump(); }, timeoutMs);
        jobs.add(job); queue.push(job); signal?.addEventListener('abort', job.abort, { once: true }); pump();
      });
    },
    snapshot: () => ({ ...stats, pending: jobs.size, threads: slots.filter(s => !s.retiring).length, workers, maxQueue, memoryMb, timeoutMs, closed }),
    async close() {
      if (closed) return;
      closed = true;
      for (const job of [...jobs]) { stats.cancelled++; finish(job, new Error("CPU pool closed.")); }
      await Promise.all(slots.map(slot => { slot.retiring = true; return slot.worker.terminate(); })); slots.length = 0;
    }
  };
}

// Shared by the entire process, rather than one expensive pool for every agent.
export const explorationCpu = createCpuPool();
