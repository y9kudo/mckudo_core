import {Worker,parentPort} from 'node:worker_threads';
import {EventEmitter} from 'node:events';
import {integer} from '../learning/contracts.js';
import {createWatchdog} from './monitoring.js';

/** Call after actual loop progress, not from a timer that can mask a stuck async operation. */
export function reportHeartbeat(detail={}) {if(!parentPort)throw new Error('Heartbeat must run inside a supervised worker');parentPort.postMessage({type:'overmind:heartbeat',detail});}

/** Parent-thread supervision can terminate a blocked worker without freezing the dashboard. */
export function createWorkerSupervisor({module,workerData={},timeoutMs=10000,maxRestarts=3,restartWindowMs=60000,memoryMb=128}={}) {
  if(!(module instanceof URL)||module.protocol!=='file:')throw new Error('Supervisor needs a local module URL');integer(memoryMb,32,1024,'memoryMb');
  const events=new EventEmitter();let worker,generation=0,closed=false,status='starting',lastError=null;
  const spawn=()=>{const current=++generation;worker=new Worker(module,{execArgv:[],workerData:structuredClone(workerData),resourceLimits:{maxOldGenerationSizeMb:memoryMb,maxYoungGenerationSizeMb:8,stackSizeMb:2}});
    worker.on('message',message=>{if(closed||current!==generation)return;if(message?.type==='overmind:heartbeat'){watchdog.heartbeat();status='ready';events.emit('heartbeat',message.detail);}else events.emit('message',message);});
    worker.on('error',error=>{if(closed||current!==generation)return;lastError=error.message;status='failed';watchdog.trip();});
    worker.on('exit',code=>{if(closed||current!==generation)return;lastError=`Worker exited: ${code}`;status='failed';watchdog.trip();});
  };
  const watchdog=createWatchdog({timeoutMs,maxRestarts,restartWindowMs,restart:async()=>{if(closed)return;status='restarting';generation++;await worker?.terminate();if(!closed)spawn();}});
  const monitor=setInterval(()=>{void watchdog.check().then(async r=>{if(closed)return;if(r.status==='blocked'&&status!=='blocked'){status='blocked';generation++;await worker?.terminate();events.emit('blocked',{reason:lastError||'Heartbeat missing; restart budget exhausted'});}else if(r.status==='restarted')events.emit('restart');}).catch(error=>{lastError=error.message;});},Math.max(10,Math.min(1000,Math.floor(timeoutMs/3))));
  try{spawn();}catch(e){clearInterval(monitor);watchdog.close();throw e;}
  return {events,snapshot:()=>({status,generation,memoryMb,lastError,watchdog:watchdog.snapshot()}),async close(){if(closed)return;closed=true;status='closed';clearInterval(monitor);watchdog.close();generation++;await worker?.terminate();}};
}
