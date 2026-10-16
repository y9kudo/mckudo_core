import {isAir,isFullBlock,isHazard} from './navigation.js';
/** Local, observed ascent fallback after bounded route search; never digs its own support. */
export function planSafeAscent({position,toward,getBlock,canDig=()=>false,canPlace=()=>false,buildingBlock,occupied=()=>false}){
  const p=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(position[k])]));
  if(toward.y<=p.y||!isFullBlock(getBlock({...p,y:p.y-1})))return null;
  const safeDig=q=>{
    const b=getBlock(q);if(!b||isHazard(b)||!canDig(b,q))return false;
    return [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].every(([x,y,z])=>{const n=getBlock({x:q.x+x,y:q.y+y,z:q.z+z});return n&&!isHazard(n)&&!(y&&/sand|gravel|anvil|dripstone/.test(n.name));});
  };
  const candidates=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,z])=>({x:p.x+x,y:p.y+1,z:p.z+z})).sort((a,b)=>Math.hypot(a.x-toward.x,a.z-toward.z)-Math.hypot(b.x-toward.x,b.z-toward.z));
  for(const next of candidates){
    if(occupied(next))continue;
    const support={...next,y:p.y},floor=getBlock(support),cells=[{...p,y:p.y+2},{...next,y:next.y+1},next];
    if(!isFullBlock(floor)&&(!isAir(floor)||!buildingBlock||!canPlace(support)))continue;
    if(cells.some(q=>!isAir(getBlock(q))&&!safeDig(q)))continue;
    const dig=cells.find(q=>!isAir(getBlock(q)));
    const action=dig?{skill:'dig',args:{...dig,block:'minecraft:'+getBlock(dig).name.replace(/^minecraft:/,'')}}:!isFullBlock(floor)?{skill:'place',args:{...support,block:buildingBlock}}:{skill:'navigate',args:{...next,range:0,bridge:false,maxDrop:1}};
    return {action,destination:next,reason:'Prepare and climb a supported local ascent after route-search failure.'};
  }
  return null;
}
