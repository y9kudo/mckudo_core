import {integer,vector} from './contracts.js';

/** Explicit opt-in bridge for a trained policy and ANY observe/execute adapter. */
export function createPolicyRunner({adapter,policy,encode,actions,reward,goal=()=>false,trainSteps=0,telemetry,recorder}={}) {
  if(!adapter||['observe','execute'].some(k=>typeof adapter[k]!=='function')||!policy||typeof policy.act!=='function'||typeof encode!=='function'||!Array.isArray(actions)||actions.length!==policy.snapshot().actions||actions.some(a=>typeof a?.allowed!=='function'||typeof a.action!=='function')||typeof reward?.evaluate!=='function'||typeof goal!=='function')throw new Error('Policy runner: adapter, encoder, fixed validated action space and Reward API required');integer(trainSteps,0,1000,'trainSteps');let busy=false,steps=0;
  const timed=(name,op)=>telemetry?telemetry.trace(name,op):op();
  return {async step({signal,epsilon=0,truncated=false}={}){if(busy)throw new Error('Policy step already running');if(typeof truncated!=='boolean')throw new Error('truncated: boolean');signal?.throwIfAborted();busy=true;
    try{const before=await timed('overmind_observe',()=>adapter.observe({signal}));signal?.throwIfAborted();if(before.self?.alive===false||before.self?.health<=0||goal(before)===true)return {status:'terminated',reason:'Death or goal already observed'};const mask=actions.map(a=>a.allowed(structuredClone(before))===true);if(!mask.some(Boolean))return {status:'blocked',reason:'No locally valid action'};const observation=Array.from(vector(encode(before),policy.snapshot().inputs)),index=policy.act(observation,{epsilon,mask}),action=actions[index].action(structuredClone(before));if(!action||typeof action.skill!=='string')throw new Error('Policy action must be a skill');
      let outcome='success';try{await timed('overmind_execute',()=>adapter.execute(action,{signal}));}catch(error){if(signal?.aborted)throw signal.reason;outcome='failure';}
      signal?.throwIfAborted();const after=await timed('overmind_observe',()=>adapter.observe({signal}));signal?.throwIfAborted();const terminated=after.self?.alive===false||after.self?.health<=0||goal(after)===true,nextObservation=Array.from(vector(encode(after),policy.snapshot().inputs)),nextMask=actions.map(a=>a.allowed(structuredClone(after))===true),unavailable=!nextMask.some(Boolean);
      const transition={observation,action:index,nextObservation,terminated:terminated||unavailable,truncated:!terminated&&!unavailable&&truncated,nextActionMask:unavailable?Array(actions.length).fill(true):nextMask};
      const evaluated=reward.evaluate({...transition,before,after,outcome});transition.reward=evaluated.reward;policy.remember(transition);if(recorder)await recorder.append(transition);const training=trainSteps?await timed('overmind_train',async()=>policy.train({steps:trainSteps})):null;steps++;
      return {status:terminated?'terminated':transition.truncated?'truncated':'running',action:structuredClone(action),outcome,reward:evaluated,training,transition};
    }finally{busy=false;}
  },snapshot:()=>({busy,steps,policy:policy.snapshot()})};
}
