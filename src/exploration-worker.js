import { parentPort } from 'node:worker_threads';
import { planExploration } from './exploration.js';
import { planFrontierExploration, frontierCandidates } from './frontier-exploration.js';
import { readVoxelSnapshot } from './voxel-snapshot.js';

parentPort.on('message', ({ id, input }) => {
  try {
    if (input?.type !== 'exploration') throw new Error("Unknown task CPU.");
    const getBlock = readVoxelSnapshot(input.voxels), costs = new Map(input.costs);
    if(input.phase==='rank'){parentPort.postMessage({id,result:frontierCandidates({...input.options,maxCandidates:64,getBlock})});return;}
    const plan=input.options.strategy==='frontier'?planFrontierExploration:planExploration;
    const result = plan({ ...input.options, getBlock, candidateCost: p => costs.get(`${p.x},${p.y},${p.z}`) || 0 },input.ranking);
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: String(error.message).slice(0, 500) }); }
});
