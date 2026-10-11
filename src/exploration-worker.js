import { parentPort } from 'node:worker_threads';
import { planExploration } from './exploration.js';
import { readVoxelSnapshot } from './voxel-snapshot.js';

parentPort.on('message', ({ id, input }) => {
  try {
    if (input?.type !== 'exploration') throw new Error('Неизвестная задача CPU.');
    const getBlock = readVoxelSnapshot(input.voxels), costs = new Map(input.costs);
    const result = planExploration({ ...input.options, getBlock, candidateCost: p => costs.get(`${p.x},${p.y},${p.z}`) || 0 });
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: String(error.message).slice(0, 500) }); }
});
