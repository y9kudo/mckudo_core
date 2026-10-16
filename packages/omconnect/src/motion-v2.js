import {stepPhysics} from './physics.js';

/** Pure prediction: uses the same physics ticks as the executor, never sends packets. */
export function predictMotion({state,control,getBlock,ticks=4}){
  if(!state?.position||typeof getBlock!=='function'||!Number.isInteger(ticks)||ticks<1||ticks>20)throw new Error('Motion prediction requires state, geometry and 1–20 ticks.');
  let next=structuredClone(state);const samples=[];
  for(let tick=0;tick<ticks;tick++){
    next=stepPhysics(next,typeof control==='function'?control(structuredClone(next),tick):control||{},getBlock);
    samples.push({position:{...next.position},velocity:{...next.velocity},onGround:next.onGround,collision:next.horizontalCollision,frozen:next.frozen===true});
    if(next.frozen)break;
  }
  return {state:next,samples,blocked:samples.some(s=>s.frozen||s.collision)};
}

/** Track progress toward a fixed local endpoint; reset for every new segment. */
export function createMotionProgress({timeoutMs=1800,minProgress=.08,clock=Date.now}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<250||timeoutMs>30000||!Number.isFinite(minProgress)||minProgress<=0||minProgress>1||typeof clock!=='function')throw new Error('Invalid motion progress limits.');
  let target,best=Infinity,last=clock();
  return {update(position,goal){
    if(!position||!goal||!['x','y','z'].every(k=>Number.isFinite(position[k])&&Number.isFinite(goal[k])))throw new Error('Motion progress requires finite positions.');
    const id=[goal.x,goal.y,goal.z].join(','),remaining=Math.hypot(position.x-goal.x,position.y-goal.y,position.z-goal.z),now=clock();
    if(id!==target||remaining<best-minProgress){target=id;best=remaining;last=now;}
    return {stuck:remaining>.3&&now-last>=timeoutMs,remaining,stalledMs:now-last};
  }};
}
