import {proposeTrade} from './item-value.js';
import {runInteraction} from './interactions.js';
import {unequippedTargets} from './equipment-policy.js';
const busy=new WeakSet();
/** Two confirmed physical deliveries. A partial exchange is recorded, never replayed automatically. */
export async function runTrade({from,to,fromTargets={},toTargets={},allowGift=true,signal,peers,timeoutMs=30000,deliver=runInteraction}={}){
  if(!from||!to||from===to||busy.has(from)||busy.has(to))throw new Error('Участники обмена отсутствуют или заняты.');
  const plan=proposeTrade({from:from.inventory.snapshot(),to:to.inventory.snapshot(),fromTargets:unequippedTargets(from,fromTargets),toTargets:unequippedTargets(to,toTargets),fromFood:from.state.food,toFood:to.state.food,allowGift});
  if(!plan)return {status:'unnecessary',plan:null,deliveries:[],reason:'Нет взаимной выгоды или нужного подарка.'};
  busy.add(from);busy.add(to);const deliveries=[];
  try{
    for(const [sender,receiver,offers]of [[from,to,plan.give],[to,from,plan.receive]])for(const offer of offers){
      signal?.throwIfAborted();
      const receipt=await deliver({from:sender,to:receiver,kind:'give',...offer,signal,peers,timeoutMs});deliveries.push(receipt);
      if(receipt.status!=='completed')return {status:deliveries.some(r=>['completed','partial'].includes(r.status))?'partial':'failed',plan,deliveries,reason:receipt.reason};
    }
    return {status:'completed',plan,deliveries,reason:''};
  }catch(error){return {status:deliveries.length?'partial':'failed',plan,deliveries,reason:error.message};}
  finally{busy.delete(from);busy.delete(to);}
}
