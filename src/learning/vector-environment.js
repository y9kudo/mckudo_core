import {Worker} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {integer} from './contracts.js';
import {environmentFactory,environmentActionCount} from './environment-factory.js';

/** Many logical environments per worker, bounded threads, no Minecraft sockets. */
export function createVectorEnvironment({count=128,workers=Math.min(2,count,availableParallelism()),seed=1,memoryMb=64,timeoutMs=15000,environment={}}={}) {
  integer(count,1,4096,'count');integer(workers,1,Math.min(8,count,availableParallelism()),'workers');integer(seed,0,0xffffffff,'seed');integer(memoryMb,32,256,'memoryMb');integer(timeoutMs,100,60000,'timeoutMs');
  const validate=environment=>{if(!environment||typeof environment!=='object'||Array.isArray(environment))throw new Error('Environment must be an object');return environmentFactory({...environment,seed});};validate(environment);let actionCount=environmentActionCount(environment);
  const slots=[],pending=new Map();let sequence=0,closed=false,busy=false,steps=0,resets=0,configurations=0;
  const fatal=error=>{if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();for(const slot of slots)void slot.worker.terminate();};
  for(let i=0;i<workers;i++){
    const entries=Array.from({length:count},(_,id)=>({id,seed:(seed+id)>>>0})).filter(e=>e.id%workers===i),worker=new Worker(new URL('./environment-worker.js',import.meta.url),{execArgv:[],workerData:{entries,options:environment},resourceLimits:{maxOldGenerationSizeMb:memoryMb,maxYoungGenerationSizeMb:8,stackSizeMb:2}}),slot={worker};slots.push(slot);
    worker.on('message',m=>{const p=pending.get(`${i}:${m.id}`);if(!p)return;pending.delete(`${i}:${m.id}`);clearTimeout(p.timer);if(m.error)p.reject(new Error(m.error));else p.resolve(m.results);});
    worker.on('error',fatal);worker.on('exit',code=>{if(!closed)fatal(new Error(`Environment worker exited: ${code}`));});
  }
  const request=async(operation,args={})=>{if(closed||busy)throw new Error(closed?'Environment pool closed':'Concurrent batch calls are not supported');busy=true;
    try{const id=++sequence,lists=await Promise.all(slots.map((slot,i)=>new Promise((resolve,reject)=>{const key=`${i}:${id}`,timer=setTimeout(()=>fatal(new Error('Environment worker timeout')),timeoutMs);pending.set(key,{resolve,reject,timer});slot.worker.postMessage({id,operation,...args});})));return lists.flat().sort((a,b)=>a.id-b.id).map(e=>({id:e.id,...e.result}));}
    catch(error){fatal(error);throw error;}finally{busy=false;}};
  return {
    async reset({indices}={}){if(indices!==undefined&&(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=count)))throw new Error('reset indices: unique environment IDs');const r=await request('reset',{indices});resets+=r.length;return r;},
    async step(actions){if(!Array.isArray(actions)||actions.length!==count||actions.some(a=>!Number.isInteger(a)||a<0||a>=actionCount))throw new Error(`step requires ${count} valid actions`);const r=await request('step',{actions});steps+=r.length;return r;},
    async setEnvironment(environment){validate(environment);const r=await request('configure',{environment});actionCount=environmentActionCount(environment);resets+=r.length;configurations++;return r;},
    snapshot:()=>({count,workers,memoryMbPerWorker:memoryMb,steps,resets,configurations,closed,busy}),
    async close(){closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Environment pool closed'));}pending.clear();await Promise.all(slots.map(s=>s.worker.terminate()));}
  };
}
