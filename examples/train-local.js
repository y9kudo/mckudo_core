import {mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setImmediate as yieldLoop} from 'node:timers/promises';
import {availableParallelism} from 'node:os';
import {createDQN,createVectorEnvironment,createHeadlessEnvironment,HEADLESS_ACTIONS,HEADLESS_FEATURES,HEADLESS_FEATURE_SCHEMA,HEADLESS_ACTION_SCHEMA,createTelemetry,createReplayWriter} from '../src/intelligence.js';

const flags=Object.fromEntries(process.argv.slice(2).map(a=>{const m=/^--(envs|workers|batches|seed|task|output|replay)=(.+)$/.exec(a);if(!m)throw new Error(`Unknown option: ${a}`);return [m[1],m[2]];}));
const count=Number(flags.envs??128),workers=Number(flags.workers??Math.min(2,availableParallelism())),batches=Number(flags.batches??1500),seed=Number(flags.seed??42),task=flags.task??'wood';
if(!Number.isInteger(batches)||batches<1||batches>100000)throw new Error('batches: 1..100000');
const output=resolve(flags.output??'data/rl-local');await mkdir(output,{recursive:true});
const policy=createDQN({inputs:HEADLESS_FEATURES.length,actions:HEADLESS_ACTIONS.length,hidden:32,batchSize:64,capacity:20000,learningRate:.001,seed}),telemetry=createTelemetry();
const evaluate=()=>{let successes=0,totalSteps=0;for(let i=0;i<64;i++){const env=createHeadlessEnvironment({seed:100000+i,task,maxSteps:160}),first=env.reset();let o=first;
  for(let t=0;t<160;t++){const r=env.step(policy.act(o.observation,{mask:o.actionMask}));totalSteps++;if(r.terminated||r.truncated){successes+=+r.info.success;break;}o={observation:r.observation,actionMask:r.info.actionMask};}}
  return {episodes:64,successes,successRate:successes/64,meanSteps:totalSteps/64,seeds:'100000..100063 (excluded from training)'};
};
const before=evaluate(),pool=createVectorEnvironment({count,workers,seed,environment:{task,maxSteps:160}});let recorder;
const start=performance.now();let episodes=0,successes=0,transitions=0;const samples=[];
console.log(JSON.stringify({phase:'start',count,workers,task,before}));
try{
  if(flags.replay==='true')recorder=await createReplayWriter({path:resolve(output,`transitions-${Date.now()}.ndjson`),featureSchema:HEADLESS_FEATURE_SCHEMA,actionSchema:HEADLESS_ACTION_SCHEMA,maxBytes:256*1024*1024});
  let states=await pool.reset();
  for(let batch=0;batch<batches;batch++){
    const epsilon=Math.max(.05,1-batch/(batches*.8)),actions=states.map(s=>policy.act(s.observation,{epsilon,mask:s.actionMask})),results=await telemetry.trace('mckudo_environment_step',()=>pool.step(actions));
    for(const r of results){const transition={observation:states[r.id].observation,action:actions[r.id],reward:r.reward,nextObservation:r.observation,terminated:r.terminated,truncated:r.truncated,nextActionMask:r.info.actionMask};policy.remember(transition);if(recorder)await recorder.append(transition);transitions++;if(r.terminated||r.truncated){episodes++;successes+=+r.info.success;}}
    const training=await telemetry.trace('mckudo_training',async()=>policy.train({steps:2}));states=results.map(r=>({observation:r.observation,actionMask:r.info.actionMask}));const completed=results.filter(r=>r.terminated||r.truncated).map(r=>r.id);if(completed.length)for(const s of await pool.reset({indices:completed}))states[s.id]=s;
    if((batch+1)%100===0||batch===batches-1){const sample={batch:batch+1,transitions,episodes,successes,epsilon,loss:training.loss};samples.push(sample);console.log(JSON.stringify(sample));}
    await yieldLoop();
  }
}finally{await pool.close();await recorder?.close();}
const after=evaluate(),elapsedMs=performance.now()-start,report={schemaVersion:1,status:'completed',environment:'headless skill abstraction (not a Minecraft game run)',task,seed,count,workers,batches,transitions,episodes,trainingSuccesses:successes,before,after,elapsedMs,transitionsPerSecond:transitions/(elapsedMs/1000),rssMb:process.memoryUsage().rss/1048576,cpu:process.cpuUsage(),policy:policy.snapshot(),samples};
for(const [name,value]of [['model.json',{...policy.export(),featureSchema:HEADLESS_FEATURE_SCHEMA,actionSchema:HEADLESS_ACTION_SCHEMA}],['report.json',report]]){await writeFile(resolve(output,name+'.tmp'),JSON.stringify(value,null,2)+'\n');await rename(resolve(output,name+'.tmp'),resolve(output,name));}
await writeFile(resolve(output,'metrics.prom'),telemetry.prometheus());console.log(JSON.stringify({phase:'completed',before,after,transitionsPerSecond:report.transitionsPerSecond,rssMb:report.rssMb,report:resolve(output,'report.json')}));
