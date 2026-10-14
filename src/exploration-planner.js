import { explorationCpu } from './cpu-pool.js';
import { captureVoxels, readVoxelSnapshot } from './voxel-snapshot.js';
import { explorationCandidates } from './exploration.js';

/** A reactor can ask for a plan without waiting or blocking emergency reactions. */
export function createExplorationPlanner({ world, pool = explorationCpu, onReady = () => {}, clock = Date.now } = {}) {
  if (!world || typeof world.blockAt !== 'function' || !pool || typeof pool.run !== 'function') throw new Error("Research needed world and CPU pool.");
  let job = null, closed = false;
  const stats = { requested: 0, completed: 0, stale: 0, failed: 0 };
  const reset = () => { job?.abort.abort(new Error("Request for study replaced.")); job = null; };
  return {
    poll(options) {
      if (closed) return { status: 'blocked', reason: "The research planner is closed." };
      const { position, mode = 'surface', radius = 24, maxNodes = 800, maxCandidates = 8, visited = [], candidateCost = () => 0, context = '' } = options;
      const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])]));
      const key = JSON.stringify([world.dimension, p, mode, radius, maxNodes, maxCandidates, context]);
      if (job && (job.key !== key || !job.isCurrent())) { stats.stale++; reset(); }
      // Cache a blocked answer briefly, allowing changed chunks/conditions to trigger a new search.
      if (job?.result && (job.result.status === 'planned' || clock() - job.finishedAt < 1000)) return job.result;
      if (!job || job.result) {
        reset();
        const view = world.createReadView?.(), revision = world.revision;
        const isCurrent = view ? view.isCurrent : () => world.revision === revision;
        const current = job = { key, abort: new AbortController(), isCurrent, result: null }; stats.requested++;
        const base = { position: p, mode, radius, maxNodes, maxCandidates, visited: structuredClone(visited) };
        current.promise = (async () => {
          const voxels = await captureVoxels({ ...base, getBlock: view ? view.blockAt : q => world.blockAt(q), signal: current.abort.signal, isCurrent });
          const costs = new Map();
          // Only the short candidate ranking uses learned policy functions in the main thread.
          // A* itself receives plain data and runs in the worker.
          explorationCandidates({ ...base, getBlock: readVoxelSnapshot(voxels), candidateCost: q => { const value = candidateCost(q); costs.set(`${q.x},${q.y},${q.z}`, value); return value; } });
          return pool.run({ type: 'exploration', voxels, options: base, costs: [...costs] }, { signal: current.abort.signal });
        })().then(result => {
          if (job !== current || closed) return;
          if (!isCurrent()) { stats.stale++; reset(); return; }
          current.result = result; current.finishedAt = clock(); stats.completed++; onReady();
        }).catch(error => {
          if (job !== current || closed) return;
          stats.failed++; current.result = { status: 'blocked', reason: String(error.message).slice(0, 500) }; current.finishedAt = clock(); onReady();
        });
      }
      return { status: 'pending', reason: "CPU computes a safe research point; Protection and physics continue to work." };
    },
    invalidate: reset,
    snapshot: () => ({ ...stats, pending: Boolean(job && !job.result), cpu: pool.snapshot?.() ?? null }),
    close() { closed = true; reset(); }
  };
}
