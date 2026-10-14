import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {integer} from '../learning/contracts.js';

/** Small in-process metrics. Optional OTel tracer injection avoids a mandatory SDK/exporter. */
export function createTelemetry({tracer,capacity=256,clock=()=>performance.now()}={}) {
  integer(capacity,1,4096,'capacity');const metrics=new Map(),spans=[];const valid=name=>{if(typeof name!=='string'||!/^[a-zA-Z_:][a-zA-Z0-9_:]{0,95}$/.test(name))throw new Error('Metric name');};
  const add=(name,value)=>{valid(name);if(!Number.isFinite(value)||!metrics.has(name)&&metrics.size>=capacity)throw new Error('Invalid metric/capacity');metrics.set(name,(metrics.get(name)||0)+value);};
  return {increment:add,async trace(name,operation){valid(name);if(typeof operation!=='function')throw new Error('trace operation');const start=clock(),traceId=randomBytes(16).toString('hex');let error=false;
    const run=async span=>{try{const value=await operation();span?.setStatus({code:1});return value;}catch(e){error=true;span?.setStatus({code:2});span?.recordException(e);throw e;}finally{span?.end();}};
    try{return tracer?await tracer.startActiveSpan(name,run):await run();}finally{add(`${name}_count`,1);add(`${name}_duration_seconds_sum`,Math.max(0,clock()-start)/1000);if(error)add(`${name}_errors_total`,1);spans.push({name,traceId,durationMs:Math.max(0,clock()-start),error});if(spans.length>capacity)spans.shift();}},
    prometheus(){return [...metrics].map(([name,value])=>`# TYPE ${name} counter\n${name} ${value}`).join('\n')+'\n';},snapshot:()=>({metrics:Object.fromEntries(metrics),spans:structuredClone(spans)})};
}

/** Heartbeats and restart circuit breaker. Restart must cancel/terminate the old runner first. */
export function createWatchdog({timeoutMs=10000,maxRestarts=3,restartWindowMs=60000,restart,clock=Date.now}={}) {
  integer(timeoutMs,10,3600000,'timeoutMs');integer(maxRestarts,0,100,'maxRestarts');integer(restartWindowMs,timeoutMs,86400000,'restartWindowMs');if(typeof restart!=='function')throw new Error('Watchdog restart callback required');let last=clock(),restarts=[],busy=false,circuit=false,closed=false,failures=0;
  return {heartbeat(){if(closed)throw new Error('Watchdog closed');last=clock();},trip(){last=clock()-timeoutMs;},async check(){if(closed||busy||circuit||clock()-last<timeoutMs)return {status:closed?'closed':circuit?'blocked':busy?'restarting':'healthy'};restarts=restarts.filter(t=>clock()-t<restartWindowMs);if(restarts.length>=maxRestarts){circuit=true;return {status:'blocked'};}busy=true;restarts.push(clock());try{await restart();last=clock();return {status:'restarted'};}catch(error){failures++;return {status:'failed',reason:error.message};}finally{busy=false;}},snapshot:()=>({lastHeartbeat:last,restarts:restarts.length,busy,circuit,closed,failures}),close(){closed=true;}};
}

/** Deterministic death/recovery state machine; inventory and completion are re-observed. */
export function createRecoveryPolicy({maxDeaths=5,respawnDelayMs=1000,clock=Date.now}={}) {
  integer(maxDeaths,0,1000,'maxDeaths');integer(respawnDelayMs,0,60000,'respawnDelayMs');let phase='working',deaths=0,deadAt=0,deathPosition=null,deathDimension=null;
  return {update(o){if(phase==='blocked')return {phase,action:null,deaths};if(o.self?.alive===false||o.self?.health<=0){if(phase!=='dead'&&phase!=='respawning'){deaths++;deadAt=clock();deathPosition=structuredClone(o.self.position);deathDimension=o.dimension;phase=deaths>maxDeaths?'blocked':'dead';}if(phase==='dead'&&clock()-deadAt>=respawnDelayMs){phase='respawning';return {phase,action:{type:'respawn'},deaths};}return {phase,action:null,deaths};}
    if(phase==='dead'||phase==='respawning'){phase='recovering';return {phase,action:{type:'rebuild',deathPosition,deathDimension,revalidateGoals:true},deaths};}return {phase,action:null,deaths};},resume(){if(phase!=='recovering')throw new Error('Recovery not ready');phase='working';},snapshot:()=>({phase,deaths,maxDeaths,deathPosition,deathDimension})};
}
