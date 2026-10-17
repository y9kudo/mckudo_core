import {setTimeout as delay} from 'node:timers/promises';
import {storageIdentity} from '../packages/omconnect/src/containers.js';
import {OMActionError} from '../packages/omconnect/src/failures.js';
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
const cell=p=>'cell/'+p.x+','+p.y+','+p.z;
const storageSkills=new Set(['lootChest','inspectStorage','takeStorage','depositStorage','labelStorage']);
const editSkills=new Set(['dig','gather','place','ignitePortal','fillEndFrame']);

/** Permission hooks, never a second executor or a replacement for live collision checks. */
export function attachSwarmAgent(client,{coordinator,name=client.options.username,maxWaitMs=1500}={}){
  if(!coordinator||typeof coordinator.acquire!=='function'||!Number.isInteger(maxWaitMs)||maxWaitMs<0||maxWaitMs>5000)throw new Error('Swarm attachment requires a coordinator and maxWaitMs 0–5000.');
  if(!coordinator.snapshot().members.includes(name))throw new Error('Unknown swarm member.');
  if(client.actionCoordinator||client.navigationCoordinator)throw new Error('Client already has coordination hooks.');
  const detached=new AbortController();let attached=true;
  const traffic={maxWaitMs,reserve:request=>{detached.signal.throwIfAborted();return coordinator.reservePath({...request,agent:name});},release:token=>{if(token)coordinator.release(name,token);coordinator.cancelWait(name,'path');}};
  const actions={async run(action,{signal},perform){
    const args=action.args||{},p=point(args)?floor(args):null,resources=[];
    if(p&&storageSkills.has(action.skill)){
      const identity=storageIdentity(client.world,p);
      const positions=identity?.positions||[p],block=client.world.blockAt(p),props=block?.getProperties?.()||{};
      // A chest partner can be across an unloaded chunk boundary. Reserve its possible
      // cell without treating it as an observed block or as inventory evidence.
      if(identity?.kind==='chest'||identity?.kind==='trapped_chest'){
        const side={north:[1,0],east:[0,1],south:[-1,0],west:[0,-1]}[props.facing];
        if(side&&['left','right'].includes(props.type)){const sign=props.type==='left'?1:-1;positions.push({...p,x:p.x+side[0]*sign,z:p.z+side[1]*sign});}
      }
      for(const position of positions)resources.push(cell(position));
    }else if(p&&editSkills.has(action.skill))resources.push(cell(p));
    const abort=new AbortController(),combined=AbortSignal.any([signal,detached.signal,abort.signal]);
    if(!resources.length)return perform(combined);
    let lease,heartbeat;const started=Date.now(),dimension=client.state.dimension;
    try{
      while(true){
        combined.throwIfAborted();if(client.state.dimension!==dimension)throw new OMActionError('STALE_WORLD','Dimension changed while waiting for a resource.');const result=coordinator.acquire({agent:name,dimension,resources,durationMs:5000});
        if(result.status==='granted'){lease=result.token;break;}
        if(Date.now()-started>=maxWaitMs)throw new OMActionError('OCCUPIED',result.reason);
        client.stopMovement();await delay(25,undefined,{signal:combined});
      }
      heartbeat=setInterval(()=>{try{if(client.state.dimension!==dimension)throw new OMActionError('STALE_WORLD','Dimension changed during a reserved action.');if(!coordinator.renew(name,lease,5000))throw new OMActionError('OCCUPIED','Swarm resource lease expired; re-observe before retrying.');}catch(error){abort.abort(error);}},1000);heartbeat.unref();
      return await perform(combined);
    }finally{clearInterval(heartbeat);if(lease)coordinator.release(name,lease);coordinator.cancelWait(name);}
  }};
  client.navigationCoordinator=traffic;client.actionCoordinator=actions;
  return ()=>{if(!attached)return;attached=false;detached.abort(new Error('Swarm attachment released.'));if(client.navigationCoordinator===traffic)client.navigationCoordinator=undefined;if(client.actionCoordinator===actions)client.actionCoordinator=undefined;coordinator.releaseAgent(name);};
}
