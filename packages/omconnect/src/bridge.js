import {isAir,isFullBlock,isHazard} from './navigation.js';
import {bridgeMaterials} from './movement.js';

const cell=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});

/** Directed, bounded bridge for high platforms where generic A* branches too widely. */
export async function bridgeTo(c,args,signal,{run}){
  const start=cell(c.state.position),target=cell(args),dx=target.x-start.x,dz=target.z-start.z;
  if(![target.x,target.y,target.z].every(Number.isFinite)||target.y!==start.y||Boolean(dx)===Boolean(dz)||Math.abs(dx+dz)>64)throw new Error("bridgeTo: target at the same height and on the same axle, to 64 blocks.");
  const length=Math.abs(dx+dz),step={x:Math.sign(dx),z:Math.sign(dz)},points=Array.from({length},(_,i)=>({x:start.x+step.x*(i+1),y:start.y,z:start.z+step.z*(i+1)}));
  if(!c.state.onGround||!isFullBlock(c.world.blockAt({...start,y:start.y-1})))throw new Error("Bridge: No confirmed start-up support.");
  const materials=bridgeMaterials(c.registry,c.inventory.items(),{blockAtState:id=>c.world.Block.fromStateId(id,0),dimension:c.state.dimension});
  const needed=points.filter(p=>isAir(c.world.blockAt({...p,y:p.y-1}))).length;
  if(materials.reduce((n,m)=>n+m.count,0)<needed)throw new Error("Bridge: not sufficiently secure building blocks.");
  for(const p of points){
    const below=c.world.blockAt({...p,y:p.y-1});
    if(!isAir(c.world.blockAt(p))||!isAir(c.world.blockAt({...p,y:p.y+1}))||!below||isHazard(below)||!isAir(below)&&!isFullBlock(below))throw new Error("Bridge: corridor or support unknown or dangerous.");
  }
  const placed=[],dimension=c.state.dimension;
  try{
    for(const p of points){
      signal.throwIfAborted();if(c.state.health<=8||c.state.status!=='ready'||c.state.dimension!==dimension)throw new Error("Bridge interrupted from-for agent status.");
      const support={...p,y:p.y-1};
      if(isAir(c.world.blockAt(support))){
        const block=bridgeMaterials(c.registry,c.inventory.items(),{blockAtState:id=>c.world.Block.fromStateId(id,0),dimension:c.state.dimension})[0];if(!block)throw new Error("Bridge: The blocks are over.");
        await run(c,{skill:'place',args:{...support,block:block.block}},signal);
        if(!isFullBlock(c.world.blockAt(support)))throw new Error("Bridge: The server did not confirm the installation of the support.");placed.push(support);
      }
      await run(c,{skill:'navigate',args:{...p,range:0,bridge:false,sprintJump:false,sprint:false}},signal);
      if(Math.floor(c.state.position.x)!==p.x||Math.floor(c.state.position.z)!==p.z||Math.abs(c.state.position.y-p.y)>.15)throw new Error("Bridge: Not confirmed for another step.");
    }
    return {ok:true,serverConfirmed:true,from:start,to:target,placed};
  }finally{c.stopMovement();}
}
