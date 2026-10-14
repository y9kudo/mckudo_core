import {gazeAngles} from './players.js';

const rad = Math.PI / 180;
const eye = (state) => ({x:state.position.x,y:state.position.y+1.62,z:state.position.z});
const view = ({yaw,pitch}) => ({x:-Math.sin(yaw*rad)*Math.cos(pitch*rad),y:-Math.sin(pitch*rad),z:Math.cos(yaw*rad)*Math.cos(pitch*rad)});

/** A conservative margin around the Java 1.21.1 Enderman stare cone. */
export function endermanGazeRisk(state,angles,entities,{margin=2}={}) {
  if(!state?.position||!Number.isFinite(angles?.yaw)||!Number.isFinite(angles?.pitch))return null;
  const from=eye(state),direction=view(angles);
  for(const e of entities){
    if(e?.name!=='enderman'||!e.position)continue;
    const to={x:e.position.x-from.x,y:e.position.y+(e.eyeHeight??2.55)-from.y,z:e.position.z-from.z};
    const distance=Math.hypot(to.x,to.y,to.z);
    if(distance<.1||distance>64)continue;
    const dot=(direction.x*to.x+direction.y*to.y+direction.z*to.z)/distance;
    if(dot>1-.025*margin/distance)return {entityId:String(e.id),distance,dot};
  }
  return null;
}

/** Keep yaw motion while pitching away from any observed Enderman eyes. */
export function safeEndermanAngles(state,desired,entities) {
  if(!endermanGazeRisk(state,desired,entities))return desired;
  const pitches=[desired.pitch+12,desired.pitch-12,desired.pitch+25,desired.pitch-25,45,-45,70,-70,85,-85]
    .map(p=>Math.max(-89,Math.min(89,p)));
  for(const pitch of pitches){const candidate={yaw:desired.yaw,pitch};if(!endermanGazeRisk(state,candidate,entities))return candidate;}
  for(const yaw of [desired.yaw+45,desired.yaw-45,desired.yaw+90,desired.yaw-90,desired.yaw+180])for(const pitch of [desired.pitch,45,-45,85,-85]){
    const candidate={yaw,pitch};if(!endermanGazeRisk(state,candidate,entities))return candidate;
  }
  return {yaw:desired.yaw+180,pitch:89};
}

export function safeLookTarget(state,target,entities) {
  const from=eye(state),angles=gazeAngles(from,target),safe=safeEndermanAngles(state,angles,entities);
  if(safe.pitch===angles.pitch)return target;
  const ray=view(safe),distance=Math.max(8,Math.hypot(target.x-from.x,target.y-from.y,target.z-from.z));
  return {x:from.x+ray.x*distance,y:from.y+ray.y*distance,z:from.z+ray.z*distance};
}
