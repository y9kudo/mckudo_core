import {setTimeout as delay} from 'node:timers/promises';

/** Bounded lifecycle recovery. Rebuild must re-observe the world before resuming work. */
export function createMissionRecovery({recover, maxAttempts=4, baseDelayMs=500, maxDeaths=5}={}) {
  if(typeof recover!=='function')throw new Error('Recovery requires a recover callback.');
  for(const [name,n,min,max]of[['maxAttempts',maxAttempts,1,16],['baseDelayMs',baseDelayMs,0,60000],['maxDeaths',maxDeaths,0,100]])if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid recovery '+name+'.');
  let enabled=false, closed=false, controller, pending, phase='paused', attempts=0, deaths=0, reason='', error='';
  const pause=()=>{enabled=false;controller?.abort();if(!closed)phase='paused';};
  return {
    enable(){if(closed)throw new Error('Recovery is closed.');enabled=true;if(!pending)phase='working';},
    pause,
    request(cause){
      if(!['death','disconnected'].includes(cause))throw new Error('Unknown recovery cause.');
      if(closed||!enabled||pending)return pending||Promise.resolve();
      if(cause==='death'&&++deaths>maxDeaths){phase='blocked';enabled=false;reason='Death budget exhausted.';return Promise.resolve();}
      reason=cause;attempts=0;error='';const ac=controller=new AbortController();
      pending=(async()=>{
        phase='recovering';
        while(enabled&&!closed&&!ac.signal.aborted&&attempts<maxAttempts){
          attempts++;
          try{
            await delay(Math.min(60000,baseDelayMs*2**(attempts-1)),undefined,{signal:ac.signal});
            ac.signal.throwIfAborted();await recover({reason:cause,attempt:attempts,signal:ac.signal});ac.signal.throwIfAborted();phase='working';return;
          }catch(e){if(ac.signal.aborted)return;error=String(e.message).slice(0,400);}
        }
        if(enabled&&!closed){phase='blocked';enabled=false;reason='Recovery attempt budget exhausted.';}
      })().finally(()=>{pending=null;if(controller===ac)controller=null;});
      return pending;
    },
    snapshot:()=>({phase,enabled,attempts,deaths,maxAttempts,maxDeaths,reason,error}),
    async close(){closed=true;pause();await pending;phase='closed';}
  };
}
