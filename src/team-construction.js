import {createHash, randomUUID} from 'node:crypto';
import {jsonCopy} from './config.js';
import {blockKey, validateBlueprint} from './construction.js';

const neighbours = [[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
const air = value => ['air','cave_air','void_air'].includes(value?.name?.replace(/^minecraft:/,''));
const matches = (value, cell) => value?.name?.replace(/^minecraft:/,'') === cell.block.replace(/^minecraft:/,'');
const position = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const identifier = s => typeof s === 'string' && s.length > 0 && s.length <= 128;
const name = s => typeof s === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(s);

/** A bounded in-process work queue. Observations, never stored receipts, prove completion. */
export function createConstructionProject({id, worldId, dimension, blueprint, agents, leaseMs=10000, maxAttempts=2, clock=Date.now, checkpoint}={}) {
  if (![id,worldId,dimension].every(identifier) || !Array.isArray(agents) || !agents.length || agents.length>20 || agents.some(a=>!name(a)) || new Set(agents).size!==agents.length) throw new Error('Construction: project/world/dimension and 1–20 unique agent names required.');
  if (!Number.isInteger(leaseMs) || leaseMs<300 || leaseMs>30000 || !Number.isInteger(maxAttempts) || maxAttempts<1 || maxAttempts>10 || typeof clock!=='function') throw new Error('Construction: lease 300–30000 ms, attempts 1–10 and a clock required.');
  const b=validateBlueprint(blueprint), members=[...agents];
  // Stateful and multi-step placements use dedicated builders; never silently discard their states.
  if (b.cells.some(c=>c.properties!==undefined&&(!c.properties||typeof c.properties!=='object'||Array.isArray(c.properties)||Object.keys(c.properties).length))) throw new Error('Team construction requires blocks without state properties.');
  if(b.dependent?.some(c=>!c.block))throw new Error('Dependent construction cells require a block ID.');
  if ((b.air?.length||0)+(b.dependent?.length||0)>4096) throw new Error('Construction: at most 4096 additional constraints.');
  const fingerprint=createHash('sha256').update(JSON.stringify({id,worldId,dimension,blueprint:b})).digest('hex');
  const records=new Map(b.cells.map(c=>[blockKey(c),{cell:c,attempts:0,error:'',state:'unknown'}]));
  const leases=new Map(), claimed=new Map();let closed=false, constraints=[], observedAt=null;
  const now=()=>{const value=clock();if(!Number.isFinite(value)||value<0)throw new Error('Invalid construction clock.');return value;};
  const context=c=>{
    if(closed)throw new Error('Construction project closed.');
    if(!c||!members.includes(c.agent)||c.worldId!==worldId||c.dimension!==dimension)throw new Error('Construction agent or world scope mismatch.');
  };
  const remove=lease=>{leases.delete(lease.agent);claimed.delete(lease.key);};
  const expire=()=>{const t=now();for(const lease of leases.values())if(lease.expiresAt<=t)remove(lease);};
  const refresh=read=>{
    if(typeof read!=='function')throw new Error('Construction needs a synchronous observed block reader.');
    const cache=new Map(), get=p=>{const k=blockKey(p);if(!cache.has(k)){const v=read({...p});if(v&&typeof v.then==='function')throw new Error('Construction observations must be synchronous.');cache.set(k,v);}return cache.get(k);};
    const updates=[...records.values()].map(r=>{const v=get(r.cell);return [r,v==null?'unknown':matches(v,r.cell)?'confirmed':air(v)?'pending':'conflict'];});
    const checks=[...(b.air||[]).map(c=>({cell:c,kind:'air'})),...(b.dependent||[]).map(cell=>({cell,kind:'dependent'}))].map(c=>({...c,state:get(c.cell)==null?'unknown':(c.kind==='air'?air(get(c.cell)):matches(get(c.cell),c.cell))?'confirmed':c.kind==='dependent'&&air(get(c.cell))?'pending':'conflict'}));
    // Finish all reads before changing the observation table.
    for(const [r,state]of updates)r.state=state;
    constraints=checks;observedAt=now();return get;
  };
  const snapshot=({maxCells=128}={})=>{
    if(!Number.isInteger(maxCells)||maxCells<0||maxCells>4096)throw new Error('Construction snapshot: maxCells 0–4096.');
    expire();const cells=[...records].map(([key,r])=>({key,position:{x:r.cell.x,y:r.cell.y,z:r.cell.z},block:r.cell.block,state:r.state,attempts:r.attempts,error:r.error,agent:claimed.get(key)?.agent||null}));
    const confirmed=cells.filter(c=>c.state==='confirmed').length;
    const status=closed?'closed':observedAt!==null&&confirmed===cells.length&&constraints.every(c=>c.state==='confirmed')&&!leases.size?'completed':leases.size?'building':'pending';
    const visible=cells.filter(c=>c.agent||c.state!=='confirmed').concat(cells.filter(c=>!c.agent&&c.state==='confirmed')).slice(0,maxCells);
    return {id,worldId,dimension,fingerprint,status,observedAt,total:cells.length,confirmed,remaining:cells.length-confirmed,cells:visible,truncated:cells.length>maxCells||constraints.length>maxCells,constraints:constraints.slice(0,maxCells).map(c=>({position:{x:c.cell.x,y:c.cell.y,z:c.cell.z},kind:c.kind,state:c.state})),leases:[...leases.values()].map(l=>({...l}))};
  };
  if(checkpoint!==undefined){
    const c=jsonCopy(checkpoint,'$',4*1048576);
    if(c.schemaVersion!==1||c.fingerprint!==fingerprint||!Array.isArray(c.failures)||c.failures.length>records.size)throw new Error('Construction checkpoint does not match the project.');
    const seen=new Set();for(const f of c.failures){const r=records.get(f.key);if(!r||seen.has(f.key)||!Number.isInteger(f.attempts)||f.attempts<0||f.attempts>maxAttempts||typeof f.error!=='string'||f.error.length>120)throw new Error('Invalid construction failure checkpoint.');seen.add(f.key);r.attempts=f.attempts;r.error=f.error;}
  }
  return {
    id,worldId,dimension,leaseMs,snapshot,
    claim(c){
      context(c);expire();if(leases.has(c.agent))return {status:'busy'};
      if(!position(c.position)||typeof c.creative!=='boolean'||!c.inventory||typeof c.inventory!=='object'||Array.isArray(c.inventory))throw new Error('Construction needs position, inventory and creative mode.');
      const get=refresh(c.readBlock);
      if(snapshot({maxCells:0}).status==='completed')return {status:'completed'};
      if(constraints.some(c=>c.kind==='air'?c.state!=='confirmed':['unknown','conflict'].includes(c.state)))return {status:'blocked',reason:'Site constraints are unobserved or occupied.'};
      let unknown=false, conflict=false, exhausted=false, shortage=false;
      const candidates=[];
      for(const [key,r]of records){
        if(r.state==='confirmed'||claimed.has(key))continue;
        if(r.state==='unknown'){unknown=true;continue;}
        if(r.state==='conflict'){conflict=true;continue;}
        if(r.attempts>=maxAttempts){exhausted=true;continue;}
        if(!c.creative&&!(Number.isInteger(c.inventory[r.cell.block])&&c.inventory[r.cell.block]>0)){shortage=true;continue;}
        if(!neighbours.some(([dx,dy,dz])=>{const v=get({x:r.cell.x+dx,y:r.cell.y+dy,z:r.cell.z+dz});return v&&!air(v)&&v.boundingBox==='block';}))continue;
        candidates.push([key,r]);
      }
      candidates.sort(([,a],[,b])=>a.cell.y-b.cell.y||Math.hypot(a.cell.x-c.position.x,a.cell.y-c.position.y,a.cell.z-c.position.z)-Math.hypot(b.cell.x-c.position.x,b.cell.y-c.position.y,b.cell.z-c.position.z)||blockKey(a.cell).localeCompare(blockKey(b.cell)));
      const next=candidates[0];
      if(!next)return {status:leases.size?'waiting':shortage?'needs-materials':'blocked',reason:leases.size?'Other workers have pending placements; observe the next batch.':unknown?'Some cells are not observed.':conflict?'Existing blocks differ; automatic removal is forbidden.':exhausted?'Placement retry budget exhausted.':shortage?'This worker lacks material.':'No observed support is available.'};
      const [key,r]=next,lease={agent:c.agent,key,token:randomUUID(),expiresAt:now()+leaseMs};leases.set(c.agent,lease);claimed.set(key,lease);
      return {status:'claimed',lease:{...lease},action:{skill:'place',args:{x:r.cell.x,y:r.cell.y,z:r.cell.z,block:r.cell.block}}};
    },
    renew(c){context(c);expire();const l=leases.get(c.agent);if(!l||l.token!==c.token)return false;l.expiresAt=now()+leaseMs;return true;},
    release(c){context(c);expire();const l=leases.get(c.agent);if(!l||l.token!==c.token)return false;remove(l);return true;},
    finish(c){
      context(c);expire();const l=leases.get(c.agent);if(!l||l.token!==c.token)return {status:'stale'};
      refresh(c.readBlock);remove(l);const r=records.get(l.key);
      if(r.state==='confirmed'){r.error='';return {status:'confirmed'};}
      r.attempts=Math.min(maxAttempts,r.attempts+1);r.error=String(c.error?.message||c.error||'Placement was not observed after execution.').slice(0,500);
      return {status:'unconfirmed',reason:r.error};
    },
    checkpoint(){return {schemaVersion:1,fingerprint,failures:[...records].filter(([,r])=>r.attempts).map(([key,r])=>({key,attempts:r.attempts,error:r.error.slice(0,120)}))};},
    close(){closed=true;leases.clear();claimed.clear();}
  };
}

/** Execute ordinary OMConnect actions. A successful executor return alone cannot complete a cell. */
export async function runConstructionBatch(client, project, {agent=client.options?.username, worldId=project.worldId, signal=AbortSignal.timeout(120000), maxActions=16}={}) {
  if(!Number.isInteger(maxActions)||maxActions<1||maxActions>4096)throw new Error('Construction batch: maxActions 1–4096.');
  const check=()=>{signal.throwIfAborted();if(client.state.status!=='ready'||client.state.dimension!==project.dimension||client.state.health<=0)throw new Error('Construction worker left the ready project world.');};
  const scope={agent,worldId,dimension:project.dimension};let actions=0,confirmed=0;
  const result=(status,reason)=>({status,actions,confirmed,reason:reason||'',project:project.snapshot()});
  while(actions<maxActions){
    check();const creative=client.state.gameMode==='creative';
    const job=project.claim({...scope,position:client.state.position,inventory:client.inventory.snapshot(),creative,readBlock:p=>client.world.blockAt(p)});
    if(job.status!=='claimed')return result(job.status,job.reason);
    const abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]),lease={...scope,token:job.lease.token};
    const heartbeat=setInterval(()=>{try{check();if(!project.renew(lease))throw new Error('Construction lease expired.');}catch(error){abort.abort(error);}},Math.max(50,Math.floor(project.leaseMs/3)));heartbeat.unref();
    try{
      if(creative&&!client.inventory.count(job.action.args.block))await client.execute({skill:'creativeTake',args:{item:job.action.args.block,count:64,replace:true}},{signal:combined,priority:100});
      check();combined.throwIfAborted();
      if(!project.renew(lease))throw new Error('Construction lease lost before dispatch.');
      let error;actions++;
      try{await client.execute(job.action,{signal:combined,priority:100});}catch(e){error=e;}
      check();combined.throwIfAborted();
      const receipt=project.finish({...lease,readBlock:p=>client.world.blockAt(p),error});if(receipt.status==='stale')throw new Error('Construction receipt belongs to an expired lease.');
      if(receipt.status==='confirmed')confirmed++;
    }finally{
      clearInterval(heartbeat);try{project.release(lease);}catch{/* A closed project already released its claims. */}
    }
  }
  const state=project.snapshot();return result(state.status==='completed'?'completed':'partial');
}
