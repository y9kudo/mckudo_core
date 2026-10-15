const center=p=>({x:p.x+.5,y:p.y,z:p.z+.5});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

/** Bounded lookahead; never skip an edit, vertical transition or learned detour. */
export function walkTarget(state,steps,index,corridor,{shortcuts=true,maxDistance=16}={}) {
  if(steps[index]?.kind!=='walk')return index;
  let end=index;
  const start=index?steps[index-1].position:Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(state.position[k])]));
  let direction=null;
  for(let i=index;i<steps.length&&i<index+64;i++) {
    const step=steps[i],previous=i===index?start:steps[i-1].position;
    if(step.kind!=='walk'||step.position.y!==steps[index].position.y)break;
    const heading={x:step.position.x-previous.x,z:step.position.z-previous.z};
    if(!direction)direction=heading;
    if(!shortcuts&&(heading.x!==direction.x||heading.z!==direction.z))break;
    const target=center(step.position),d=distance(state.position,target);
    if(d>maxDistance)break;
    // At a block center the A* edge is sufficient; shortcuts require the whole footprint.
    if(i===index||corridor(state.position,{x:target.x-state.position.x,z:target.z-state.position.z},d))end=i;
  }
  return end;
}

/** Preserve velocity only into an observed, same-height walking continuation. */
export function continuesWalk(state,steps,index,corridor) {
  const a=steps[index],b=steps[index+1];
  if(a?.kind!=='walk'||b?.kind!=='walk'||a.position.y!==b.position.y)return false;
  const end=center(a.position),target=center(b.position),approach=distance(state.position,end)||1;
  const from={x:end.x+(state.position.x-end.x)/approach*.5,y:end.y,z:end.z+(state.position.z-end.z)/approach*.5},d=distance(from,target);
  return d<=16&&corridor(from,{x:target.x-from.x,z:target.z-from.z},d);
}
