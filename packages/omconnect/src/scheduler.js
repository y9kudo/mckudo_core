import { performance } from 'node:perf_hooks';

/** A bounded, round-robin CPU queue shared by agents. Iterator steps must be short. */
export function createWorkScheduler({ budgetMs = 4, maxJobs = 128 } = {}) {
  if (!Number.isFinite(budgetMs) || budgetMs < .5 || budgetMs > 20 || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 1024) throw new Error('Scheduler: budgetMs 0.5–20, maxJobs 1–1024.');
  const queue = [], jobs = new Set();
  let scheduled = null, closed = false;
  const stats = { completed: 0, failed: 0, cancelled: 0, turns: 0, maxTurnMs: 0 };
  const settle = (job, error, value) => {
    if (!jobs.delete(job)) return;
    job.signal?.removeEventListener('abort', job.abort);
    const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
    if (error) { try { job.iterator.return?.(); } catch {} job.reject(error); }
    else job.resolve(value);
    if (!jobs.size && scheduled) { clearImmediate(scheduled); scheduled = null; }
  };
  const schedule = () => { if (!scheduled && queue.length && !closed) scheduled = setImmediate(pump); };
  function pump() {
    scheduled = null; const began = performance.now(), deadline = began + budgetMs; stats.turns++;
    // Every job gets one quantum before another round. New arrivals join the tail.
    let remaining = queue.length;
    while (queue.length && remaining-- > 0 && performance.now() < deadline) {
      const job = queue.shift(); if (!jobs.has(job)) continue;
      try {
        job.signal?.throwIfAborted(); job.validate?.();
        const until = Math.min(deadline, performance.now() + job.sliceMs);
        for (let n = 0; n < job.nodesPerSlice; n++) {
          job.signal?.throwIfAborted();
          const step = job.iterator.next();
          if (!jobs.has(job)) { job.iterator.return?.(); break; }
          if (!step || typeof step.done !== 'boolean' || typeof step.then === 'function') throw new Error("Scheduler requires synchronic Iterator.");
          if (step.done) { stats.completed++; settle(job, null, step.value); break; }
          if (performance.now() >= until) break;
        }
        if (jobs.has(job)) queue.push(job);
      } catch (error) { if (jobs.has(job)) { stats.failed++; settle(job, error); } }
    }
    stats.maxTurnMs = Math.max(stats.maxTurnMs, performance.now() - began); schedule();
  }
  return {
    submit(iterator, { signal, sliceMs = 2, nodesPerSlice = 64, validate } = {}) {
      if (!iterator || typeof iterator.next !== 'function' || !Number.isFinite(sliceMs) || sliceMs < .5 || sliceMs > 10 || !Number.isInteger(nodesPerSlice) || nodesPerSlice < 1 || nodesPerSlice > 256 || validate !== undefined && typeof validate !== 'function') throw new Error('Scheduler: Iterator, sliceMs 0.5–10, nodesPerSlice 1–256.');
      if (closed || jobs.size >= maxJobs) { iterator.return?.(); return Promise.reject(new Error(closed ? "Scheduler closed." : "Computation queue is full.")); }
      if (signal?.aborted) { iterator.return?.(); return Promise.reject(signal.reason); }
      return new Promise((resolve, reject) => {
        const job = { iterator, signal, sliceMs, nodesPerSlice, validate, resolve, reject };
        job.abort = () => { if (jobs.has(job)) { stats.cancelled++; settle(job, signal.reason); } };
        jobs.add(job); queue.push(job); signal?.addEventListener('abort', job.abort, { once: true }); schedule();
      });
    },
    snapshot: () => ({ ...stats, pending: jobs.size, closed, budgetMs, maxJobs }),
    close() { if (closed) return; closed = true; clearImmediate(scheduled); scheduled = null; for (const job of [...jobs]) { stats.cancelled++; settle(job, new Error("Scheduler closed.")); } }
  };
}

export const navigationScheduler = createWorkScheduler();
