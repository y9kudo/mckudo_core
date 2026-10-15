/** Progress is a change in game evidence, not elapsed timer or repeated successful waits. */
export function createCampaignJournal({clock=Date.now,stallAfterMs=120000,maxEntries=128,objective='enter-end'}={}){
  if(typeof clock!=='function'||!Number.isInteger(stallAfterMs)||stallAfterMs<1000||stallAfterMs>3600000||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>1024||!['enter-end','defeat-dragon','visit-nether'].includes(objective))throw new Error("Campaign journal: Uncorrect settings.");
  const startedAt=clock();let progressAt=startedAt,stage=null,fingerprint=null,last=null;const entries=[];
  const observe=({scenario,self,inventory={},endgame={}})=>{
    const now=clock();
    // Coordinates are excluded: walking in circles is not campaign progression.
    const next=JSON.stringify([scenario.current,scenario.completed,self.dimension,Object.entries(inventory).filter(([,n])=>n>0).sort(([a],[b])=>a.localeCompare(b)),(endgame.crystals??[]).map(c=>c.entityId).sort(),endgame.dragonDeath?.confirmed===true]);
    if(next!==fingerprint){fingerprint=next;progressAt=now;entries.push({at:now,stage:scenario.current,completed:[...scenario.completed],dimension:self.dimension});if(entries.length>maxEntries)entries.shift();}
    stage=scenario.current;
    const proof=objective==='defeat-dragon'?Boolean(endgame.dragonDeath?.confirmed&&endgame.dragonDeath?.ownDamageConfirmed):self.dimension===(objective==='visit-nether'?'minecraft:the_nether':'minecraft:the_end');
    last={objective,stage,reason:scenario.reason??'',elapsedMs:Math.max(0,now-startedAt),idleMs:Math.max(0,now-progressAt),status:self.health<=0?'dead':scenario.status==='completed'?(proof?'completed':'unverified'):now-progressAt>=stallAfterMs?'stalled':scenario.status==='blocked'?'blocked':'running',goalConfirmed:scenario.status==='completed'&&proof};
    return snapshot();
  };
  const snapshot=()=>structuredClone({...last,objective,stage,entries});
  return {observe,snapshot};
}
