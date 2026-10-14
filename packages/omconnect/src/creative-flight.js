import {setTimeout as delay} from 'node:timers/promises';
import {isAir,isFullBlock} from './navigation.js';

const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const key=p=>`${p.x},${p.y},${p.z}`;

/** Local six-direction flight route; every cell must fit the complete player body. */
export function planCreativeFlightRoute(start,goal,clear,{maxNodes=12000,signal}={}){
  const from={x:Math.floor(start.x),y:Math.floor(start.y),z:Math.floor(start.z)};
  const bounds={minX:Math.min(from.x,goal.x)-8,maxX:Math.max(from.x,goal.x)+8,minY:Math.min(from.y,goal.y)-5,maxY:Math.max(from.y,goal.y)+8,minZ:Math.min(from.z,goal.z)-8,maxZ:Math.max(from.z,goal.z)+8};
  const queue=[from],seen=new Map([[key(from),null]]),nodes=new Map([[key(from),from]]);
  const steps=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for(let index=0;index<queue.length&&index<maxNodes;index++){
    if(index%256===0)signal?.throwIfAborted();
    const current=queue[index];
    if(key(current)===key(goal)){
      const path=[];let cursor=key(current);
      while(cursor!==null){path.push(nodes.get(cursor));cursor=seen.get(cursor);}
      return path.reverse();
    }
    for(const [dx,dy,dz] of steps){
      const next={x:current.x+dx,y:current.y+dy,z:current.z+dz};
      if(next.x<bounds.minX||next.x>bounds.maxX||next.y<bounds.minY||next.y>bounds.maxY||next.z<bounds.minZ||next.z>bounds.maxZ)continue;
      const id=key(next);if(seen.has(id)||!clear({x:next.x+.5,y:next.y,z:next.z+.5}))continue;
      seen.set(id,key(current));nodes.set(id,next);queue.push(next);
    }
  }
  return null;
}

/** Creative flight remains subject to loaded-block collision and server correction. */
export async function executeCreativeFly(c,args,signal){
  if(c.state.gameMode!=='creative'||!c.state.allowFlying)throw new Error("Creative-Flight not authorized by server.");
  if(!point(args)||!Number.isInteger(args.y)||!Number.isInteger(args.x)||!Number.isInteger(args.z))throw new Error("creativeFly: integers are required x/y/z.");
  if(distance(c.state.position,args)>128)throw new Error("Flight limited 128 block-by-act.");
  const target={x:args.x+.5,y:args.y,z:args.z+.5},land=args.land!==false;
  const clear=p=>{
    for(const dx of [-.28,.28])for(const dz of [-.28,.28])for(const h of [0,1])if(!isAir(c.world.blockAt({x:Math.floor(p.x+dx),y:Math.floor(p.y)+h,z:Math.floor(p.z+dz)})))return false;
    return true;
  };
  if(!clear(target))throw new Error("Flight destination taken or not observed.");
  if(land&&!isFullBlock(c.world.blockAt({x:args.x,y:args.y-1,z:args.z})))throw new Error("A monitored support is required to land.");
  const clearSegment=(a,b)=>Array.from({length:Math.ceil(distance(a,b)/.25)+1},(_,i)=>{
    const t=Math.min(1,i*.25/Math.max(.01,distance(a,b)));
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
  }).every(clear);
  const direct=Boolean(args.direct&&c.state.creativeFlying&&distance(c.state.position,target)<=6&&clearSegment(c.state.position,target));
  let routed=[];
  if(!direct&&args.pathfind&&distance(c.state.position,target)<=32){
    const path=planCreativeFlightRoute(c.state.position,args,clear,{signal});
    if(path){
      for(let index=0;index<path.length-1;){
        let next=Math.min(path.length-1,index+6);
        while(next>index+1&&!clearSegment(index===0?c.state.position:{x:path[index].x+.5,y:path[index].y,z:path[index].z+.5},{x:path[next].x+.5,y:path[next].y,z:path[next].z+.5}))next--;
        routed.push({x:path[next].x+.5,y:path[next].y,z:path[next].z+.5});index=next;
      }
      routed.push(target);
    }
  }
  const cruise=Math.max(c.state.position.y+2,target.y+3),waypoints=direct?[target]:routed.length?routed:[{x:c.state.position.x,y:cruise,z:c.state.position.z},{x:target.x,y:cruise,z:target.z},target];
  c.setCreativeFlying(true);
  let corrections=c.metrics.corrections;
  try{
    for(const waypoint of waypoints){
      const until=Date.now()+Math.max(3500,distance(c.state.position,waypoint)*550);
      while(distance(c.state.position,waypoint)>.36){
        signal.throwIfAborted();if(c.state.status!=='ready'||Date.now()>until)throw new Error("Budget expired Creative-Flight.");
        if(c.metrics.corrections-corrections>2)throw new Error("The server has rejected the flight trajectory.");
        const p=c.state.position,dx=waypoint.x-p.x,dy=waypoint.y-p.y,dz=waypoint.z-p.z,h=Math.hypot(dx,dz);
        const lead={x:p.x+Math.max(-1,Math.min(1,dx)),y:p.y+Math.max(-1,Math.min(1,dy)),z:p.z+Math.max(-1,Math.min(1,dz))};
        if(!clear(lead))throw new Error("Impediment or unladen area ahead.");
        c.lookAt({x:waypoint.x,y:waypoint.y+1,z:waypoint.z},{signal,turnSpeed:360});
        c.control={x:h>.24?dx/h*Math.min(1,h/1.2):0,z:h>.24?dz/h*Math.min(1,h/1.2):0,up:dy>.35,down:dy<-.35,jump:false,sprint:false};
        await delay(25,undefined,{signal});
      }
      c.stopMovement();
    }
    if(land){
      // Hover until the physics engine confirms ordinary ground contact.
      const until=Date.now()+3000;
      while(!c.state.onGround&&Date.now()<until){signal.throwIfAborted();c.control={x:0,z:0,down:true,up:false,jump:false,sprint:false};await delay(25,undefined,{signal});}
      if(!c.state.onGround)throw new Error("The server didn't confirm the landing.");
      c.stopMovement();c.setCreativeFlying(false);
    }
    return {ok:true,serverConfirmed:true,position:{...c.state.position},flying:c.state.creativeFlying,landed:land&&c.state.onGround};
  }finally{c.stopMovement();}
}
