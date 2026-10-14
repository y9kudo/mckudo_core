import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCpuPool, planExploration } from '../overmindmc.js';
import { captureVoxels, readVoxelSnapshot } from '../src/voxel-snapshot.js';

// A closed observed wall separates reachable ground from preferred frontiers.
// This compares the same bounded exploration search, not network latency or game skill.
const position={x:0,y:64,z:0},air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const voxels=await captureVoxels({position,radius:24,getBlock:p=>p.y<64||Math.max(Math.abs(p.x),Math.abs(p.z))===20?stone:air});
const getBlock=readVoxelSnapshot(voxels),options={position,radius:24,maxNodes:12000,maxCandidates:16};
const input={type:'exploration',voxels,options,costs:[]},pool=createCpuPool();
async function measure(run){
  await delay(10);let last=performance.now(),maxGap=0,ticks=0;
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},5);
  const cpu=process.cpuUsage(),began=performance.now();
  try {
    const result=await run(),durationMs=performance.now()-began,used=process.cpuUsage(cpu);
    maxGap=Math.max(maxGap,performance.now()-last);const heartbeatTicks=ticks;await delay(10);
    return {status:result.status,attempts:result.attempts,durationMs,cpuMs:(used.user+used.system)/1000,heartbeatTicks,maxHeartbeatGapMs:maxGap,rssMiB:process.memoryUsage().rss/1048576};
  } finally {clearInterval(timer);}
}
try{
  await pool.run(input); // Warm-up worker/module loading is outside the comparison.
  const synchronous=await measure(()=>planExploration({...options,getBlock}));
  const worker=await measure(()=>pool.run(input));
  const report={at:new Date().toISOString(),node:process.version,kind:'synthetic-exploration',synchronous,worker,pool:pool.snapshot(),note:'The JS heap limit is not a total process RAM cap or a CPU percentage limit. World snapshot capture is outside both measurements.'};
  await mkdir('data',{recursive:true});await writeFile('data/cpu-responsiveness.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await pool.close();}
