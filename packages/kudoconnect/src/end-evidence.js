const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Server evidence only: entity disappearance or a sent attack is never a kill. */
export function installEndEvidence(c,{clock=Date.now}={}) {
  const crystals=new Map(), explosions=[], ownHits=new Map();
  c.endgame.crystals=[];
  const inEnd=()=>c.state.dimension==='minecraft:the_end';
  const trim=()=>{
    const now=clock();while(explosions.length && now-explosions[0].at>2000)explosions.shift();
    for(const [id,e] of crystals)if(e.goneAt && now-e.goneAt>2000)crystals.delete(id);
    while(crystals.size>128)crystals.delete(crystals.keys().next().value);
  };
  const reconcile=()=>{
    trim();
    for(const [id,e] of crystals) {
      if(!e.goneAt || !explosions.some(x=>Math.abs(x.at-e.goneAt)<=1500 && distance(x.position,e.position)<=2))continue;
      if(!c.endgame.crystals.some(x=>x.entityId===id)) {
        const proof={entityId:id,position:{...e.position},confirmed:true,evidence:'explosion-and-removal',at:clock()};
        c.endgame.crystals.push(proof);c.endgame.crystals=c.endgame.crystals.slice(-128);c.emit('crystalDestroyed',proof);
      }
      crystals.delete(id);
    }
  };
  const death=(e,evidence)=>{
    if(!inEnd() || e?.name!=='ender_dragon' || c.endgame.dragonDeath?.entityId===e.id)return;
    const proof={entityId:e.id,confirmed:true,evidence,ownDamageConfirmed:ownHits.has(e.id),ownHitCount:ownHits.get(e.id)||0,at:clock()};
    c.endgame.dragonDeath=proof;c.emit('dragonDefeated',proof);
  };
  c.on('entity',e=>{
    if(!inEnd())return;
    if(e.name==='end_crystal'){crystals.set(e.id,{position:{...e.position}});trim();}
    if(e.name==='ender_dragon' && Number.isFinite(e.metadata?.health) && e.metadata.health<=0 && e.metadata?.phase===9)death(e,'health-zero-and-dying-phase');
  });
  c.on('entityGone',e=>{if(inEnd()&&e?.name==='end_crystal'){const entry=crystals.get(e.id);if(entry){entry.goneAt=clock();reconcile();}}});
  c.on('explosion',e=>{if(inEnd()){explosions.push({position:e.position,at:clock()});while(explosions.length>128)explosions.shift();reconcile();}});
  c.on('damage',e=>{
    if(!inEnd() || e.sourceId!==String(c.state.entityId) || c.entities.get(Number(e.entityId))?.name!=='ender_dragon')return;
    ownHits.set(e.entityId,(ownHits.get(e.entityId)||0)+1);
    while(ownHits.size>32)ownHits.delete(ownHits.keys().next().value);
    c.endgame.ownDragonHits=(c.endgame.ownDragonHits||0)+1;
  });
  c.on('entityDead',e=>death(e,'entity-death-status'));
  c.on('respawnPacket',()=>{crystals.clear();explosions.length=0;});
}
