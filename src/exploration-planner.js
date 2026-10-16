import { explorationCpu } from './cpu-pool.js';
import { captureVoxels, readVoxelSnapshot } from './voxel-snapshot.js';
import { explorationCandidates } from './exploration.js';

/** A reactor can ask for a plan without waiting or blocking emergency reactions. */
export function createExplorationPlanner({ world, pool = explorationCpu, onReady = () => {}, clock = Date.now, atlas, strategy = 'frontier' } = {}) {
  if (!world || typeof world.blockAt !== 'function' || !pool || typeof pool.run !== 'function') throw new Error("Research needed world and CPU pool.");
  let job = null, closed = false;
  const children=new Set();
  const stats = { requested: 0, completed: 0, stale: 0, failed: 0 };
  const reset = () => { job?.abort.abort(new Error("Request for study replaced.")); job = null; };
  return {
    poll(options) {
      if (closed) return { status: 'blocked', reason: "The research planner is closed." };
      const { position, mode = 'surface', radius = 24, maxNodes = 800, maxCandidates = 8, maxDrop = 3, visited = [], candidateCost = () => 0, context = '', policyRevision = 0 } = options;
      const selectedStrategy=options.strategy??(typeof pool.rankFrontiers==='function'?strategy:'legacy');
      if(!['frontier','legacy'].includes(selectedStrategy))throw new Error('Exploration strategy must be frontier or legacy.');
      if(selectedStrategy==='frontier'&&typeof pool.rankFrontiers!=='function')throw new Error('Frontier exploration needs pool.rankFrontiers; use legacy for an older custom pool.');
      if(!Array.isArray(visited)||visited.length>1024||visited.some(v=>!v||!['x','y','z'].every(k=>Number.isFinite(v[k]))))throw new Error('Exploration visited points are invalid.');
      if(!['string','number'].includes(typeof policyRevision)||typeof policyRevision==='number'&&!Number.isFinite(policyRevision))throw new Error('Exploration policyRevision must be a string or finite number.');
      if (!Number.isInteger(maxDrop) || maxDrop < 1 || maxDrop > 32) throw new Error('Exploration maxDrop: an integer 1–32.');
      if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k])&&Math.abs(position[k])<30000000)||!Number.isInteger(radius)||radius<4||radius>32||!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>100000||!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>64)throw new Error('Exploration position or search budgets are invalid.');
      const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])]));
      const key = JSON.stringify([world.dimension, p, mode, radius, maxNodes, maxCandidates, maxDrop, context, selectedStrategy, visited, policyRevision, atlas?.snapshot().revision]);
      if (job && (job.key !== key || !job.isCurrent())) { stats.stale++; reset(); }
      // Cache a blocked answer briefly, allowing changed chunks/conditions to trigger a new search.
      if (job?.result && (job.result.status === 'planned' || clock() - job.finishedAt < 1000)) return job.result;
      if (!job || job.result) {
        reset();
        const view = world.createReadView?.(), revision = world.revision;
        const isCurrent = view ? view.isCurrent : () => world.revision === revision;
        const current = job = { key, abort: new AbortController(), isCurrent, result: null }; stats.requested++;
        const base = { position: p, mode, radius, maxNodes, maxCandidates, maxDrop, visited: structuredClone(visited), strategy:selectedStrategy };
        current.promise = (async () => {
          const voxels = await captureVoxels({ ...base, getBlock: view ? view.blockAt : q => world.blockAt(q), signal: current.abort.signal, isCurrent });
          const costs = new Map();
          // Only the short candidate ranking uses learned policy functions in the main thread.
          // A* itself receives plain data and runs in the worker.
          const cost=q=>{const user=candidateCost(q);if(!Number.isFinite(user)||user<0||user>1000)throw new Error('candidateCost must be finite and within 0–1000.');const value=Math.min(1000,user+(atlas?.explorationCost({dimension:world.dimension,position:q})??0));costs.set(`${q.x},${q.y},${q.z}`,value);return value;};
          let ranking;
          if(selectedStrategy==='frontier'){
            ranking=await pool.rankFrontiers({type:'exploration',voxels,options:base,costs:[]},{signal:current.abort.signal});
            current.abort.signal.throwIfAborted();if(!isCurrent())throw new Error('World changed during frontier ranking.');
            for(const c of ranking)cost(c.p);
          }else explorationCandidates({...base,getBlock:readVoxelSnapshot(voxels),candidateCost:cost});
          return pool.run({ type: 'exploration', voxels, options: base, costs: [...costs],ranking }, { signal: current.abort.signal });
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
    invalidate(){reset();for(const child of children)child.invalidate();},
    fork(){
      if(closed||children.size>=64)throw new Error('The exploration planner is closed or its child limit was reached.');
      const child=createExplorationPlanner({world,pool,onReady,clock,atlas,strategy}),close=child.close;
      child.close=()=>{close();children.delete(child);};children.add(child);return child;
    },
    snapshot: () => ({ ...stats, pending: Boolean(job && !job.result), cpu: pool.snapshot?.() ?? null }),
    close() { closed = true; reset();for(const child of children)child.close();children.clear(); }
  };
}
