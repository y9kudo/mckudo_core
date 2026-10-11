import {equipmentTradeTargets,unequippedTargets} from './equipment-policy.js';
import {proposeTrade} from './item-value.js';
import {runTrade} from './trade.js';

const tiers=['leather','golden','chainmail','wooden','stone','iron','diamond','netherite'];
const group=item=>item.endsWith('_bed')?'bed':['helmet','chestplate','leggings','boots','pickaxe','sword','axe'].find(part=>item.endsWith('_'+part));
const score=item=>tiers.indexOf(item.replace(/^minecraft:/,'').split('_')[0]);
const equipment=c=>Object.values(c.inventory.equipment?.()||{}).filter(Boolean);
const owned=c=>[...Object.keys(c.inventory.snapshot()),...equipment(c).map(i=>i.item)];

/** Needs include everyday equipment, even while the long-term goal is diamond gear. */
export function teamSupplyTargets(client,clients,goals={}){
  const targets=equipmentTradeTargets(client,goals),available=[];
  for(const donor of clients){
    for(const [item,count]of Object.entries(donor.inventory.snapshot())){
      if(group(item)&&count+(equipment(donor).some(i=>i.item===item)?1:0)>1)available.push(item);
    }
  }
  const candidates=[...new Set([...owned(client),...available])];
  for(const part of ['helmet','chestplate','leggings','boots','pickaxe','sword','axe','bed']){
    const best=candidates.filter(item=>group(item)===part).sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
    if(best)targets[best]=Math.max(1,targets[best]||0);
  }
  return targets;
}

export function proposeTeamTransfer({clients,targets=()=>({}),maxDistance=16}={}){
  for(const from of clients)for(const to of clients){
    if(from===to||from.state.status!=='ready'||to.state.status!=='ready'||from.state.dimension!==to.state.dimension||from.state.health<=8||to.state.health<=8)continue;
    const p=from.state.position,q=to.state.position;if(!p||!q||Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>maxDistance)continue;
    const fromTargets=teamSupplyTargets(from,clients,targets(from)),toTargets=teamSupplyTargets(to,clients,targets(to));
    const proposal=proposeTrade({from:from.inventory.snapshot(),to:to.inventory.snapshot(),fromTargets:unequippedTargets(from,fromTargets),toTargets:unequippedTargets(to,toTargets)});
    if(proposal)return {from,to,fromTargets,toTargets,proposal};
  }
  return null;
}

/** Bounded, acknowledged physical transfers. Stop on partial delivery, never replay it. */
export async function shareTeamSupplies({clients,targets,peers,signal,maxTransfers=12,deliver}={}){
  if(!Array.isArray(clients)||clients.length<2||clients.length>20||!Number.isInteger(maxTransfers)||maxTransfers<1||maxTransfers>64)throw new Error('Обмен команды: 2–20 клиентов, maxTransfers 1–64.');
  const transfers=[];
  for(let i=0;i<maxTransfers;i++){
    signal?.throwIfAborted();const next=proposeTeamTransfer({clients,targets});
    if(!next)return {status:'completed',transfers};
    const receipt=await runTrade({...next,peers,signal,...(deliver?{deliver}:{})});
    transfers.push({from:next.from.options.username,to:next.to.options.username,...receipt});
    if(receipt.status!=='completed')return {status:receipt.status,transfers};
  }
  return {status:proposeTeamTransfer({clients,targets})?'pending':'completed',transfers};
}
