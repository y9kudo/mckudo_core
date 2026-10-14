import {integer,finite} from '../learning/contracts.js';

/** Local, bounded protocol. No in-game chat; a transport may relay these typed envelopes. */
export function createTeamBlackboard({worldId,capacity=1024,ttlMs=30000,clock=Date.now}={}) {
  if(typeof worldId!=='string'||!worldId.trim())throw new Error('worldId required');integer(capacity,1,100000,'capacity');integer(ttlMs,10,86400000,'ttlMs');const records=new Map();
  const prune=()=>{for(const [id,r]of records)if(clock()>=r.expiresAt)records.delete(id);};
  return {publish({id,agent,type,payload,sequence=0}){prune();if(typeof id!=='string'||id.length>128||!id||typeof agent!=='string'||agent.length>128||!['observation','offer','request','role','danger'].includes(type))throw new Error('Invalid team envelope');integer(sequence,0,Number.MAX_SAFE_INTEGER,'sequence');const body=structuredClone(payload);if(JSON.stringify(body)?.length>32768)throw new Error('Team payload exceeds budget');const key=JSON.stringify([agent,id]),old=records.get(key);if(old&&old.sequence>=sequence)return false;if(!old&&records.size>=capacity)throw new Error('Team capacity exceeded');records.set(key,{worldId,id,agent,type,payload:body,sequence,expiresAt:clock()+ttlMs});return true;},
    read({type,excludeAgent}={}){prune();return structuredClone([...records.values()].filter(r=>(!type||r.type===type)&&r.agent!==excludeAgent));},snapshot(){prune();return {worldId,entries:records.size,capacity};}};
}

/** Deterministic skill/load based assignment; one role per agent, one agent per role. */
export function assignRoles(agents,roles) {
  if(!Array.isArray(agents)||!Array.isArray(roles)||agents.length>1024||roles.length>1024||new Set(agents.map(a=>a.id)).size!==agents.length||new Set(roles.map(r=>r.id)).size!==roles.length)throw new Error('Unique agent and role IDs, at most 1024');const candidates=[];
  for(const a of agents)for(const r of roles){if(typeof a.id!=='string'||typeof r.id!=='string')throw new Error('Agent/role ID');let score=-finite(a.load??0,0,1e6,'load');for(const [skill,weight]of Object.entries(r.skills||{}))score+=finite(weight,0,1000,'skill weight')*finite(a.skills?.[skill]??0,0,1,'skill level');candidates.push({agent:a.id,role:r.id,score});}
  candidates.sort((a,b)=>b.score-a.score||a.agent.localeCompare(b.agent)||a.role.localeCompare(b.role));const selected=[],usedAgents=new Set(),usedRoles=new Set();for(const c of candidates)if(!usedAgents.has(c.agent)&&!usedRoles.has(c.role)){selected.push(c);usedAgents.add(c.agent);usedRoles.add(c.role);}return selected;
}

/** Validates a multi-item offer before existing inventory-transfer skills execute it. */
export function evaluateExchange({left,right,giveLeft={},giveRight={}}) {
  const utility=(party,give,take)=>{let score=0;for(const [item,count]of Object.entries(give)){integer(count,1,4096,'exchange count');if((party.inventory?.[item]||0)-(party.reserves?.[item]||0)<count)return null;score-=count*finite(party.values?.[item]??1,0,1e6,'item value');}for(const [item,count]of Object.entries(take)){integer(count,1,4096,'exchange count');score+=count*finite(party.values?.[item]??1,0,1e6,'item value');}return score;};
  if(!left||!right||Object.keys(giveLeft).length>64||Object.keys(giveRight).length>64)throw new Error('Exchange parties/items');const a=utility(left,giveLeft,giveRight),b=utility(right,giveRight,giveLeft);return {accepted:a!==null&&b!==null&&a>0&&b>0,leftGain:a,rightGain:b,requiresInventoryRevalidation:true};
}
