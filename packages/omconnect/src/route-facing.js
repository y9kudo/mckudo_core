/** Keep route heading stable when a falling player overshoots a waypoint. */
export function routeFacingTarget(state,from,to){
  const dx=to.x-from.x,dz=to.z-from.z,d=Math.hypot(dx,dz),yaw=(state.yaw||0)*Math.PI/180;
  return {x:state.position.x+(d>0?dx/d:-Math.sin(yaw))*8,y:state.position.y+1.62,z:state.position.z+(d>0?dz/d:Math.cos(yaw))*8};
}
