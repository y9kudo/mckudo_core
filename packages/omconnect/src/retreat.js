import {isAir,isFullBlock,isHazard} from './navigation.js';

/** A single short terrain opening, never an unbounded tunnel under hostile fire. */
export function planRetreatExcavation({position,from,getBlock,canDig,miningMs,maxMiningMs=900}) {
  if(Math.hypot(position.x-from.x,position.y-from.y,position.z-from.z)<4)return null;
  const here={x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)},candidates=[];
  for(const dy of [0,1,-1])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const foot={x:here.x+dx,y:here.y+dy,z:here.z+dz};
    if(Math.hypot(foot.x+.5-from.x,foot.z+.5-from.z)<=Math.hypot(position.x-from.x,position.z-from.z)+.3)continue;
    if(!isFullBlock(getBlock({...foot,y:foot.y-1})))continue;
    const cells=[...(dy>0?[{...here,y:here.y+2}]:[]),{...foot,y:foot.y+1},foot],dig=cells.filter(p=>!isAir(getBlock(p)));if(!dig.length)continue;
    const unsafe=dig.some(p=>{const b=getBlock(p);return !b||!canDig(b,p)||!Number.isFinite(miningMs(b,p))||[[1,0,0],[-1,0,0],[0,1,0],[0,0,1],[0,0,-1]].some(([x,y,z])=>{const n=getBlock({x:p.x+x,y:p.y+y,z:p.z+z});return !n||isHazard(n)||y===1&&/(?:^|:)(?:sand|red_sand|gravel|.*concrete_powder|.*anvil)$/.test(n.name||n.id);});});
    const cost=unsafe?Infinity:dig.reduce((n,p)=>n+miningMs(getBlock(p),p),0);if(cost<=maxMiningMs)candidates.push({position:foot,dig,cost});
  }
  return candidates.sort((a,b)=>a.cost-b.cost)[0]||null;
}
