import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {availableParallelism} from 'node:os';
import {createPPO,createSAC,createPhysicalEnvironment,createVectorEnvironment,PHYSICAL_ACTIONS,PHYSICAL_FEATURES} from '../src/intelligence.js';

const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('='))),algorithm=options.algorithm||'ppo',batches=Number(options.batches||400),count=Number(options.count||32);
if(!['ppo','sac'].includes(algorithm)||!Number.isInteger(batches)||batches<1||batches>10000)throw new Error('Use --algorithm=ppo|sac --batches=1..10000');
const config={inputs:PHYSICAL_FEATURES.length,actions:PHYSICAL_ACTIONS.length,hidden:32,seed:42,learningRate:.001,batchSize:32},policy=algorithm==='ppo'?createPPO(config):createSAC(config),pool=createVectorEnvironment({count,workers:Math.min(2,count,availableParallelism()),environment:{kind:'physical',mobs:0,maxSteps:100}}),start=performance.now();let episodes=0,successes=0;
try{
  let states=await pool.reset();
  for(let batch=0;batch<batches;batch++){
    const samples=states.map(s=>policy.sample?.(s.observation,{mask:s.actionMask})),actions=states.map((s,i)=>samples[i]?.action??policy.act(s.observation,{mask:s.actionMask,deterministic:false})),results=await pool.step(actions);
    for(const r of results){policy.remember({observation:states[r.id].observation,action:actions[r.id],reward:r.reward,nextObservation:r.observation,terminated:r.terminated,truncated:r.truncated,actionMask:states[r.id].actionMask,nextActionMask:r.info.actionMask,...samples[r.id],nextValue:policy.value?.(r.observation),envId:r.id});if(r.terminated||r.truncated){episodes++;successes+=+r.info.success;}}
    policy.train();states=results.map(r=>({observation:r.observation,actionMask:r.info.actionMask}));const finished=results.filter(r=>r.terminated||r.truncated);if(finished.length)for(const r of await pool.reset({indices:finished.map(r=>r.id)}))states[r.id]=r;
    if((batch+1)%100===0)console.log(JSON.stringify({batch:batch+1,algorithm,episodes,successes}));
  }
  let passed=0;for(let seed=10000;seed<10032;seed++){const env=createPhysicalEnvironment({seed,mobs:0,maxSteps:100});let s=env.reset();for(let i=0;i<100;i++){const r=env.step(policy.act(s.observation,{mask:s.actionMask}));s={observation:r.observation,actionMask:r.info.actionMask};if(r.terminated||r.truncated){passed+=+r.info.success;break;}}}
  const directory=resolve(options.out||`data/physical-${algorithm}`);await mkdir(directory,{recursive:true});
  const report={algorithm,featureSchema:'om-physical-v1',actionSchema:'om-controls-v1',fixture:'flat, no mobs, fixed north goal',batches,transitions:batches*count,episodes,successes,heldOut:{passed,total:32},elapsedMs:performance.now()-start,rssMb:process.memoryUsage().rss/1024**2,policy:policy.snapshot()};
  await writeFile(resolve(directory,'checkpoint.json'),JSON.stringify({featureSchema:report.featureSchema,actionSchema:report.actionSchema,algorithm,config,model:policy.export()},null,2));await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await pool.close();}
