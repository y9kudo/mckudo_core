import { setTimeout as delay } from 'node:timers/promises';
import { isAir, isFullBlock } from './navigation.js';
import {assertEdit} from './protection.js';

const point = p => p && ['x','y','z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const center = p => ({x:p.x+.5,y:p.y+.5,z:p.z+.5});
const click = (c,p) => c.write('block_place',{hand:0,location:p,direction:1,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:++c.sequence});

export async function ignitePortal(c,args,signal,runtime) {
  const {origin,axis='x'}=args;
  if(!point(origin)||!['x','z'].includes(axis)||!['minecraft:overworld','minecraft:the_nether'].includes(c.state.dimension)) throw new Error("ignitePortal: origin, axis x/z and the ordinary world/Nether.");
  const frame=[],inside=[];
  for(let y=0;y<5;y++)for(let u=0;u<4;u++){
    const p={x:origin.x+(axis==='x'?u:0),y:origin.y+y,z:origin.z+(axis==='z'?u:0)};
    (y===0||y===4||u===0||u===3?frame:inside).push(p);
  }
  const ready=()=>inside.every(p=>c.world.blockAt(p)?.name==='nether_portal');
  if(ready())return {ok:true,serverConfirmed:true,alreadyActive:true};
  for(const p of inside)assertEdit(c,'place',p);
  if(!frame.every(p=>c.world.blockAt(p)?.name==='obsidian')||!inside.every(p=>isAir(c.world.blockAt(p)))) throw new Error("No whole osidian frame observed 4×5 With empty middle.");
  const bottom={...inside[0],y:origin.y};
  await runtime.approach(c,bottom,signal);await runtime.select(c,'flint_and_steel',signal);
  c.stopMovement();c.lookAt(center(bottom));await c.waitForLook({signal});for(const p of inside)assertEdit(c,'place',p);click(c,bottom);
  await c.waitFor(ready,{event:'block',signal,timeoutMs:3000});
  return {ok:true,serverConfirmed:true,entrance:inside[0]};
}

export async function fillEndFrame(c,args,signal,runtime) {
  if(!point(args)||c.state.dimension!=='minecraft:overworld')throw new Error("fillEndFrame: The reference frame in the conventional world.");
  const ready=()=>c.world.blockAt(args)?.name==='end_portal_frame'&&c.world.blockAt(args).getProperties().eye===true;
  if(ready())return {ok:true,serverConfirmed:true,alreadyFilled:true};
  assertEdit(c,'place',args);
  if(c.world.blockAt(args)?.name!=='end_portal_frame')throw new Error("Box End-No portal observed.");
  await runtime.approach(c,args,signal);await runtime.select(c,'ender_eye',signal);
  c.stopMovement();c.lookAt(center(args));await c.waitForLook({signal});assertEdit(c,'place',args);click(c,{x:args.x,y:args.y,z:args.z});
  await c.waitFor(ready,{event:'block',signal,timeoutMs:3000});
  return {ok:true,serverConfirmed:true,position:{x:args.x,y:args.y,z:args.z}};
}

/** An eye has no owner field: reject ambiguous observations instead of assigning another player's flight. */
export async function throwEye(c,args,signal,runtime) {
  if(c.state.dimension!=='minecraft:overworld')throw new Error("A drop of eye for the fort is available in the conventional world.");
  const nearbyPlayer=()=>[...c.entities.values()].some(e=>e.kind==='player'&&distance(e.position,c.state.position)<24);
  if(nearbyPlayer())throw new Error("To keep your eye on the eye, you should step away from the other players on 24 block.");
  await runtime.select(c,'ender_eye',signal);c.stopMovement();
  const before=c.inventory.count('ender_eye'),seen=new Set(c.entities.keys()),launched={...c.state.position},flights=new Map();
  c.write('use_item',{hand:0,sequence:++c.sequence,rotation:{x:c.state.yaw,y:c.state.pitch}});
  const until=Date.now()+3000;
  while(Date.now()<until){
    signal.throwIfAborted();if(nearbyPlayer())throw new Error("There was a player nearby: The flight's ownership is mixed.");
    for(const [id,e] of c.entities)if(!seen.has(id)&&e.name==='eye_of_ender'){
      if(!flights.has(id)&&distance(e.position,launched)<16)flights.set(id,{origin:{...e.position},end:{...e.position},samples:0});
      const flight=flights.get(id);if(flight){flight.end={...e.position};flight.samples++;}
    }
    await delay(50,undefined,{signal});
  }
  if(flights.size!==1||c.inventory.count('ender_eye')>=before)throw new Error("Unproven eye and only one flight of its own.");
  const [entityId,flight]=[...flights][0];
  if(flight.samples<3||distance(flight.origin,flight.end)<1)throw new Error("Not enough traffic to measure direction.");
  const observation={...flight,entityId:String(entityId),launched,dimension:c.state.dimension,at:Date.now()};
  c.endgame.eyes.push(observation);c.endgame.eyes=c.endgame.eyes.slice(-32);
  return {ok:true,serverConfirmed:true,observation};
}

/** Only the short final approach enters portal cells. The regular route planner keeps avoiding them. */
export async function enterPortal(c,args,signal,runtime) {
  const expected=args.dimension;
  if(!point(args)||!['minecraft:overworld','minecraft:the_nether','minecraft:the_end'].includes(expected)||expected===c.state.dimension)throw new Error("enterPortal: The position of the active portal and other measurement.");
  const portal=expected==='minecraft:the_end'?'end_portal':'nether_portal';
  if(c.world.blockAt(args)?.name!==portal)throw new Error("An active portal is not observed.");
  if(portal==='nether_portal'&&!['minecraft:overworld','minecraft:the_nether'].includes(c.state.dimension)||portal==='end_portal'&&c.state.dimension!=='minecraft:overworld')throw new Error("Unsupported pair of measurements.");
  await runtime.run(c,{skill:'navigate',args:{x:args.x,y:args.y,z:args.z,range:1,bridge:false,sprint:false,sprintJump:false}},signal);
  const start={...c.state.position},target=center(args),from=c.state.dimension;
  if(Math.hypot(start.x-target.x,start.z-target.z)>2.5||start.y<args.y-.1||start.y>args.y+1.1)throw new Error("Need a close support next to the portal.");
  const clear=()=>{
    if(c.world.blockAt(args)?.name!==portal)return false;
    const d=Math.hypot(target.x-start.x,target.z-start.z),steps=Math.max(1,Math.ceil(d/.15));
    for(let i=0;i<=steps;i++){
      const p={x:Math.floor(start.x+(target.x-start.x)*i/steps),y:Math.floor(start.y+.01),z:Math.floor(start.z+(target.z-start.z)*i/steps)};
      for(const dy of [0,1]){const b=c.world.blockAt({...p,y:p.y+dy});if(!isAir(b)&&b?.name!==portal)return false;}
      const below=c.world.blockAt({...p,y:p.y-1});
      if(!isFullBlock(below)&&below?.name!==portal&&c.world.blockAt(p)?.name!==portal)return false;
    }
    return true;
  };
  if(!clear())throw new Error("The last approach to the portal is not safe passage.");
  c.dimensionRequested=expected;
  try{
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      signal.throwIfAborted();
      if(c.state.dimension===expected&&c.state.status==='ready')return {ok:true,serverConfirmed:true,from,dimension:expected};
      if(c.state.dimension!==from&&c.state.dimension!==expected)throw new Error("The server sent the agent to another dimension.");
      if(c.state.status==='ready'&&c.state.dimension===from){
        if(!clear())throw new Error("Passage or portal changed.");
        const dx=target.x-c.state.position.x,dz=target.z-c.state.position.z,d=Math.hypot(dx,dz);
        c.lookAt({...target,y:start.y+1.62});c.control={x:d>.12?dx/d*.5:0,z:d>.12?dz/d*.5:0,sprint:false,jump:false};
      }else c.stopMovement();
      await delay(50,undefined,{signal});
    }
    throw new Error("The server did not confirm the transition and loading of the target measurement for 20 seconds.");
  }finally{c.dimensionRequested=null;c.stopMovement();}
}
