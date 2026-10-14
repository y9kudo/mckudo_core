import {setImmediate as yieldLoop} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {integer} from './contracts.js';

export const curriculumEnvironment=stage=>Object.fromEntries(Object.entries(stage).filter(([key])=>['task','size','maxSteps','hazards','novelty','resources'].includes(key)));

/** Shared learner across stages; old-episode results cannot certify the newly selected stage. */
export async function trainCurriculum({policy,environments,curriculum,batches=1500,stepsPerBatch=2,initialStageBatches=0,validateStage,validationEvery=100,onBatch,onStageChange,onTransition,signal}={}) {
  if(!policy||!environments||!curriculum)throw new Error('Training needs policy, environments and curriculum');integer(batches,1,100000,'batches');integer(stepsPerBatch,1,1000,'stepsPerBatch');integer(initialStageBatches,0,1000000,'initialStageBatches');
  integer(validationEvery,1,10000,'validationEvery');if(validateStage!==undefined&&typeof validateStage!=='function')throw new Error('validateStage must be a function');
  signal?.throwIfAborted();let states=await environments.setEnvironment(curriculumEnvironment(curriculum.current())),stageBatches=initialStageBatches,transitions=0,episodes=0,successes=0,promotionAllowed=!validateStage;const start=performance.now();
  for(let batch=0;batch<batches;batch++){
    signal?.throwIfAborted();const previous=curriculum.snapshot(),epsilon=Math.max(.05,.8-stageBatches/1000),actions=states.map(s=>policy.act(s.observation,{epsilon,mask:s.actionMask})),results=await environments.step(actions);
    for(const r of results){const transition={observation:states[r.id].observation,action:actions[r.id],reward:r.reward,nextObservation:r.observation,terminated:r.terminated,truncated:r.truncated,nextActionMask:r.info.actionMask};policy.remember(transition);if(onTransition)await onTransition(transition);transitions++;if(r.terminated||r.truncated){episodes++;successes+=+r.info.success;}}
    const training=policy.train({steps:stepsPerBatch});stageBatches++;let changed=false;
    if(validateStage&&(batch+1)%validationEvery===0){promotionAllowed=await validateStage(curriculum.current());if(typeof promotionAllowed!=='boolean')throw new Error('Stage validation must return boolean');}
    const completed=results.filter(r=>r.terminated||r.truncated);
    for(const r of completed){curriculum.record(r.info.success,{allowPromotion:promotionAllowed});if(curriculum.snapshot().index!==previous.index){changed=true;break;}}
    if(changed){const current=curriculum.snapshot();states=await environments.setEnvironment(curriculumEnvironment(current.stage));stageBatches=0;promotionAllowed=!validateStage;if(onStageChange)await onStageChange({batch:batch+1,previous,current,transitions,episodes,successes});}
    else{states=results.map(r=>({observation:r.observation,actionMask:r.info.actionMask}));if(completed.length)for(const s of await environments.reset({indices:completed.map(r=>r.id)}))states[s.id]=s;}
    if(onBatch)await onBatch({batch:batch+1,stageBatches,epsilon,transitions,episodes,successes,training,curriculum:curriculum.snapshot(),elapsedMs:performance.now()-start});
    await yieldLoop();
  }
  return {batches,transitions,episodes,successes,stageBatches,elapsedMs:performance.now()-start,curriculum:curriculum.snapshot()};
}
