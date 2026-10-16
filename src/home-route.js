const key=p=>`${p.x},${p.y},${p.z}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
/** Keep an observed, loop-erased corridor; these points never imply current traversability. */
export function recordHomeTrail(trail,position){
  const p=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(position[k])])),index=trail.findIndex(q=>key(q)===key(p));
  if(index>=0)trail.length=index+1;
  else if(trail.length<2048)trail.push(p);
}
/** Rejoin the corridor before following short reverse segments toward its origin. */
export function homeReturnWaypoint(trail,position,fallback){
  if(!trail.length)return fallback;
  let index=0;for(let i=1;i<trail.length;i++)if(distance(trail[i],position)<distance(trail[index],position))index=i;
  return {...trail[distance(trail[index],position)>6?index:Math.max(0,index-3)]};
}

/** Known sky access permits a new surface home site without revisiting an exact spawn height. */
export function hasOpenSky({position,getBlock,maxY=320}){
  if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k]))||!Number.isInteger(maxY)||maxY<=position.y||maxY-Math.floor(position.y)>4096)return false;
  for(let y=Math.floor(position.y)+2;y<maxY;y++){
    const b=getBlock({x:Math.floor(position.x),y,z:Math.floor(position.z)});
    if(!b)return false;
    const name=(b.name||b.id||'').replace(/^minecraft:/,'');
    if(!/^(?:air|cave_air|void_air|vine)$|_(?:leaves|log|wood)$/.test(name))return false;
  }
  return true;
}
