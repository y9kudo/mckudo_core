import {setTimeout as delay} from 'node:timers/promises';
import {OMActionError} from './failures.js';
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.z===b.z;
const floor=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});

/** Reserve only a sliding window of the validated, same-level ground route. */
export function createNavigationCoordination(client,signal){
  const hook=client.navigationCoordinator;let token,window=[];
  return {
    async update(path){
      if(!hook)return;
      const foot=floor(client.state.position),index=path.findIndex(p=>same(p,foot));
      if(index<0)throw new OMActionError('OCCUPIED','Steering left its reserved ground route; replan from the observed position.');
      window=path.slice(index,index+4);const started=Date.now();let waited=false;
      while(true){
        signal.throwIfAborted();
        const lease=await hook.reserve({dimension:client.state.dimension,positions:window});
        if(lease.status==='granted'){token=lease.token;return waited;}
        token=undefined;client.stopMovement();
        if(!waited){client.metrics.coordinationWaits=(client.metrics.coordinationWaits||0)+1;waited=true;}
        if(Date.now()-started>=hook.maxWaitMs)throw new OMActionError('OCCUPIED',lease.reason||'A teammate reserved the next ground passage.');
        await delay(25,undefined,{signal});
      }
    },
    allows(direction){
      if(!hook)return true;
      const p=client.state.position,next=floor({x:p.x+direction.x*.6,y:p.y,z:p.z+direction.z*.6});
      return window.some(cell=>same(cell,next));
    },
    release(){if(hook)hook.release(token);token=undefined;window=[];}
  };
}
