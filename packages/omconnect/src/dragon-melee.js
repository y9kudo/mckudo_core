/** Approximate the vanilla head hitbox from the observed dragon body. */
export function perchedDragonHead(dragon){
  if(!dragon?.position||!Number.isFinite(dragon.yaw))return null;
  const yaw=dragon.yaw*Math.PI/180,pitch=(dragon.pitch||0)*Math.PI/180;
  return {x:dragon.position.x+Math.sin(yaw)*6.5*Math.cos(pitch),y:dragon.position.y-1+Math.sin(pitch)*6.5,z:dragon.position.z-Math.cos(yaw)*6.5*Math.cos(pitch)};
}
