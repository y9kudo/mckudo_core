import {open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {integer} from '../learning/contracts.js';

/** Backpressured, bounded NDJSON recording of explicit RL transitions, not private client state. */
export async function createReplayWriter({path,featureSchema,actionSchema,maxBytes=64*1024*1024}={}) {
  if(typeof path!=='string'||typeof featureSchema!=='string'||typeof actionSchema!=='string')throw new Error('Replay path and schemas required');integer(maxBytes,1024,1024*1024*1024,'maxBytes');const file=await open(path,'wx');let bytes=0,sequence=0,closed=false,tail=Promise.resolve();
  const write=async row=>{const line=JSON.stringify(row)+'\n',n=Buffer.byteLength(line);if(n>1024*1024||bytes+n>maxBytes)throw new Error('Replay byte budget exceeded');await file.writeFile(line);bytes+=n;};
  try{await write({type:'header',schemaVersion:1,featureSchema,actionSchema});}catch(e){await file.close();throw e;}
  return {append(transition){if(closed)return Promise.reject(new Error('Replay closed'));if(!transition||typeof transition.terminated!=='boolean'||typeof transition.truncated!=='boolean'||!Array.isArray(transition.observation)||!Array.isArray(transition.nextObservation)||transition.observation.length>256||transition.nextObservation.length>256||![...transition.observation,...transition.nextObservation,transition.reward,transition.action].every(Number.isFinite)||!Number.isInteger(transition.action)||transition.action<0)return Promise.reject(new Error('Replay needs finite encoded transitions and terminal/truncated flags'));const row=structuredClone({type:'transition',sequence:sequence++,observation:transition.observation,action:transition.action,reward:transition.reward,nextObservation:transition.nextObservation,terminated:transition.terminated,truncated:transition.truncated,...(transition.nextActionMask?{nextActionMask:transition.nextActionMask}:{})});const pending=tail.then(()=>write(row));tail=pending;return pending;},
    snapshot:()=>({bytes,transitions:sequence,maxBytes,closed}),async close(){if(closed)return;closed=true;try{await tail;}finally{await file.close();}}};
}

/** Read-only replay; never repeats destructive actions on a live server. */
export async function* readReplay(path,{featureSchema,actionSchema,maxRecords=1000000,maxBytes=64*1024*1024}={}) {
  integer(maxRecords,1,10000000,'maxRecords');integer(maxBytes,1024,1024*1024*1024,'maxBytes');const stream=createReadStream(path,{highWaterMark:65536}),lines=createInterface({input:stream,crlfDelay:Infinity});let header=false,count=0,bytes=0;
  try{for await(const line of lines){bytes+=Buffer.byteLength(line)+1;if(bytes>maxBytes||line.length>1024*1024)throw new Error('Replay byte budget exceeded');const row=JSON.parse(line);if(!header){if(row.type!=='header'||row.schemaVersion!==1||featureSchema&&row.featureSchema!==featureSchema||actionSchema&&row.actionSchema!==actionSchema)throw new Error('Replay schema mismatch');header=true;continue;}if(row.type!=='transition'||++count>maxRecords||row.sequence!==count-1||typeof row.terminated!=='boolean'||typeof row.truncated!=='boolean')throw new Error('Invalid replay transition');yield row;}if(!header)throw new Error('Empty replay');}
  finally{lines.close();stream.destroy();}
}

export async function trainOffline(policy,path,options={}){let records=0;for await(const t of readReplay(path,options)){policy.remember(t);records++;}const training=policy.train({steps:options.steps??100});return {records,...training};}
