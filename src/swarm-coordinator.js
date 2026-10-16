import {randomUUID} from 'node:crypto';

const point=p=>p&&['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000);
const dimension=d=>typeof d==='string'&&/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(d)&&d.length<=128;
const cell=p=>'cell/'+p.x+','+p.y+','+p.z;

/** World-scoped, in-process advisory leases. The server remains the resource authority. */
export function createSwarmCoordinator({worldId,members,capacity=256,ttlMs=1500,clock=Date.now}={}){
  if(typeof worldId!=='string'||!worldId.trim()||worldId.length>128||!Array.isArray(members)||members.length<1||members.length>20||members.some(n=>typeof n!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(n))||new Set(members.map(n=>n.toLowerCase())).size!==members.length)throw new Error('Swarm requires a worldId and 1–20 unique agent names.');
  if(!Number.isInteger(capacity)||capacity<1||capacity>1024||!Number.isInteger(ttlMs)||ttlMs<100||ttlMs>30000||typeof clock!=='function')throw new Error('Invalid swarm lease budget.');
  const names=new Set(members),leases=new Map(),waiting=new Map();let sequence=0,closed=false,grants=0,conflicts=0,expired=0;
  const validateAgent=agent=>{if(!names.has(agent))throw new Error('Unknown swarm member.');};
  const open=()=>{if(closed)throw new Error('Swarm coordinator closed.');};
  const remove=token=>leases.delete(token);
  const prune=()=>{const now=clock();for(const [id,l]of leases)if(l.expiresAt<=now){remove(id);expired++;}for(const [key,w]of waiting)if(now-w.lastSeen>30000)waiting.delete(key);};
  const keyFor=(agent,kind)=>agent+'/'+kind;
  const release=(agent,token)=>{validateAgent(agent);const lease=leases.get(token);return lease?.agent===agent?remove(token):false;};
  const acquire=({agent,dimension:dim,resources,kind='resource',durationMs=ttlMs}={})=>{
    validateAgent(agent);open();prune();
    if(!dimension(dim)||!['resource','path'].includes(kind)||!Array.isArray(resources)||resources.length<1||resources.length>64||resources.some(k=>typeof k!=='string'||!/^[A-Za-z0-9_.:,|/-]{1,180}$/.test(k))||!Number.isInteger(durationMs)||durationMs<100||durationMs>30000)throw new Error('Invalid swarm resource request.');
    const keys=[...new Set(resources)].sort(),signature=JSON.stringify([dim,keys]),ownerKey=keyFor(agent,kind),own=[...leases.values()].find(l=>l.agent===agent&&l.kind===kind);
    const occupied=[...leases.values()].find(l=>l.agent!==agent&&l.dimension===dim&&l.resources.some(k=>keys.includes(k)));
    let ticket=waiting.get(ownerKey);
    if(!ticket||ticket.signature!==signature){ticket={agent,kind,dimension:dim,resources:keys,signature,order:++sequence,lastSeen:clock()};waiting.set(ownerKey,ticket);}else ticket.lastSeen=clock();
    // An existing holder can renew its identical lease; it must not be stranded by a waiter.
    const older=own?.signature===signature?null:[...waiting.values()].find(w=>w.agent!==agent&&w.dimension===dim&&w.order<ticket.order&&w.resources.some(k=>keys.includes(k)));
    const blocker=occupied||older;
    if(blocker){
      conflicts++;
      if(kind==='path'&&own)remove(own.token); // Never hold one passage while waiting for another.
      return {status:'blocked',owner:blocker.agent,reason:'A teammate holds or is waiting for the same observed resource.'};
    }
    if(!own&&leases.size>=capacity){waiting.delete(ownerKey);return {status:'blocked',owner:null,reason:'Swarm lease capacity reached.'};}
    const token=own?.signature===signature?own.token:randomUUID(),expiresAt=clock()+durationMs;
    if(own&&own.token!==token)remove(own.token);
    leases.set(token,{token,agent,kind,dimension:dim,resources:keys,signature,expiresAt});waiting.delete(ownerKey);grants++;
    return {status:'granted',token,expiresAt};
  };
  return {
    worldId,acquire,release,
    renew(agent,token,durationMs=ttlMs){validateAgent(agent);prune();if(!Number.isInteger(durationMs)||durationMs<100||durationMs>30000)throw new Error('Invalid swarm renewal duration.');const l=leases.get(token);if(!l||l.agent!==agent)return false;l.expiresAt=clock()+durationMs;return true;},
    reservePath({agent,dimension:dim,positions,durationMs}={}){
      if(!Array.isArray(positions)||positions.length<1||positions.length>8||positions.some(p=>!point(p)))throw new Error('Path reservation requires 1–8 integer positions.');
      const resources=[];
      for(let i=0;i<positions.length;i++){
        const p=positions[i];for(const dy of[-1,0,1])resources.push(cell({...p,y:p.y+dy}));
        if(i){const a=positions[i-1];if(a.y!==p.y||Math.max(Math.abs(a.x-p.x),Math.abs(a.z-p.z))>1)throw new Error('Path leases cover adjacent ground cells only.');
          resources.push('edge/'+[cell(a),cell(p)].sort().join('|'));
          if(a.x!==p.x&&a.z!==p.z)resources.push('cross/'+Math.min(a.x,p.x)+','+p.y+','+Math.min(a.z,p.z));
        }
      }
      return acquire({agent,dimension:dim,resources,kind:'path',...(durationMs!==undefined?{durationMs}:{})});
    },
    releaseAgent(agent){validateAgent(agent);for(const [id,l]of leases)if(l.agent===agent)remove(id);for(const [key,w]of waiting)if(w.agent===agent)waiting.delete(key);},
    cancelWait(agent,kind='resource'){validateAgent(agent);waiting.delete(keyFor(agent,kind));},
    snapshot(){prune();return {worldId,members:[...names],capacity,active:leases.size,grants,conflicts,expired,leases:structuredClone([...leases.values()].map(({signature,...l})=>l)),waiting:structuredClone([...waiting.values()].map(({signature,...w})=>w))};},
    close(){closed=true;leases.clear();waiting.clear();}
  };
}
