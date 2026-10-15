import {isAir,isFullBlock,isHazard} from '../packages/omconnect/src/navigation.js';

const floor=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const horizontal=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

/** Observed geometry only. The side column leaves the resource and its falling drop accessible. */
export function planResourcePillar({position,target,getBlock,previous,canPlace=()=>true,owned=()=>false,entities=[],maxRise=128}) {
  if(!Number.isInteger(maxRise)||maxRise<1||maxRise>384)throw new Error('maxRise: 1–384.');
  const p=floor(position),t=floor(target),candidates=[];
  const bases=previous?[previous.base]:[[1,0],[-1,0],[0,1],[0,-1]].flatMap(([dx,dz])=>Array.from({length:17},(_,i)=>({x:t.x+dx,y:p.y+8-i,z:t.z+dz})));
  for(const base of bases){
    if(t.y-base.y<1||t.y-base.y>maxRise||!isFullBlock(getBlock({...base,y:base.y-1})))continue;
    let top=base.y;
    while(top<t.y&&isFullBlock(getBlock({...base,y:top}))&&owned({...base,y:top}))top++;
    let clear=true;
    for(let y=top;y<=t.y+2;y++)if(!isAir(getBlock({...base,y}))||y<t.y&&!canPlace({...base,y})){clear=false;break;}
    if(!clear||entities.some(e=>e.kind==='player'&&e.position&&Math.hypot(e.position.x-base.x-.5,e.position.z-base.z-.5)<.8&&e.position.y>=top-2&&e.position.y<t.y+3))continue;
    const catchBlock={...t,y:t.y-1},under=getBlock(catchBlock);
    if(!isFullBlock(under)&&(!isAir(under)||!canPlace(catchBlock)))continue;
    const needCatch=!isFullBlock(under);
    if(needCatch&&t.y-base.y<2)continue;
    candidates.push({status:'planned',base:{...base},top:{...base,y:top},target:t,catchBlock,needCatch,stagingY:t.y-2,remaining:t.y-top,blocksNeeded:t.y-top+(needCatch?1:0)});
  }
  candidates.sort((a,b)=>horizontal(position,{x:a.base.x+.5,z:a.base.z+.5})-horizontal(position,{x:b.base.x+.5,z:b.base.z+.5})||a.blocksNeeded-b.blocksNeeded);
  return candidates[0]??{status:'blocked',reason:'No known, clear, supported side column for this elevated resource.'};
}

/** Keep the excavation at the staging ground level instead of spiraling down after each pickup. */
export function constructionSoil({position,base,getBlock,canDig=()=>true,radius=10}) {
  const candidates=[];
  for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
    if(Math.max(Math.abs(dx),Math.abs(dz))<2)continue;
    const p={x:base.x+dx,y:base.y-1,z:base.z+dz},b=getBlock(p);
    if(!['dirt','grass_block','coarse_dirt','rooted_dirt'].includes(b?.name)||!isAir(getBlock({...p,y:p.y+1}))||!isFullBlock(getBlock({...p,y:p.y-1}))||isHazard(b)||!canDig(p))continue;
    candidates.push(p);
  }
  return candidates.sort((a,b)=>horizontal(position,{x:a.x+.5,z:a.z+.5})-horizontal(position,{x:b.x+.5,z:b.z+.5}))[0]??null;
}
