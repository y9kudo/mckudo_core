import {isAir,isFullBlock} from './navigation.js';
import {traceProjectile} from './projectiles.js';
import {endermanGazeRisk} from './enderman-gaze.js';

const cell=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const degrees=Math.PI/180;
const pearlProfile={speed:1.5,gravity:.03,drag:.99,waterDrag:.8};

/** Forward-only estimate. A missing chunk is not evidence of solid ground. */
export function predictFallLanding(state,getBlock,{maxTicks=45}={}){
  if(!state?.position||!state.velocity||typeof getBlock!=='function')return null;
  let p={...state.position},v={...state.velocity};
  for(let tick=1;tick<=maxTicks;tick++){
    const next={x:p.x+v.x,y:p.y+v.y,z:p.z+v.z};
    if(v.y<0){
      const foot=cell(next);
      for(let y=Math.floor(p.y);y>=Math.floor(next.y)-1;y--){
        const surfaceY=y+1,below={x:foot.x,y,z:foot.z};
        if(p.y<surfaceY-.01||next.y>surfaceY+.01)continue;
        const support=getBlock(below);
        if(isFullBlock(support)&&isAir(getBlock({...below,y:y+1}))&&isAir(getBlock({...below,y:y+2})))
          return {ticks:tick,position:{x:next.x,y:surfaceY,z:next.z},support:below,block:support,height:state.position.y-surfaceY};
      }
    }
    p=next;v={x:v.x*.91,y:(v.y-.08)*.98,z:v.z*.91};
    if(p.y<0)break;
  }
  return null;
}

const safeLanding=(hit,getBlock)=>{
  if(hit?.reason!=='obstacle'||!hit.point||!isFullBlock(getBlock(hit.cell))||hit.point.y<hit.cell.y+.94)return false;
  const {x,z}=hit.point,y=hit.cell.y;
  // Require a broad, known patch to absorb pearl inaccuracy and player width.
  for(const dx of [-1,0,1])for(const dz of [-1,0,1]){
    const p={x:Math.floor(x)+dx,y,z:Math.floor(z)+dz};
    if(!isFullBlock(getBlock(p))||!isAir(getBlock({...p,y:y+1}))||!isAir(getBlock({...p,y:y+2})))return false;
  }
  return x-Math.floor(x)>.2&&x-Math.floor(x)<.8&&z-Math.floor(z)>.2&&z-Math.floor(z)<.8;
};

/** Candidate throws are simulated against observed collision blocks; no blind pearl. */
export function planPearlEscape(state,getBlock,{endermen=[],maxTicks=36}={}){
  if(!state?.position||!state.velocity||typeof getBlock!=='function')return null;
  const origin={...state.position,y:state.position.y+1.52},candidates=[];
  const inherited={x:state.velocity.x||0,y:state.onGround?0:state.velocity.y||0,z:state.velocity.z||0};
  for(let yaw=-180;yaw<180;yaw+=15)for(const pitch of [12,25,38,50,62,73,82]){
    if(endermanGazeRisk(state,{yaw,pitch},endermen))continue;
    const y=yaw*degrees,p=pitch*degrees;
    const velocity={x:-Math.sin(y)*Math.cos(p)*1.5+inherited.x,y:-Math.sin(p)*1.5+inherited.y,z:Math.cos(y)*Math.cos(p)*1.5+inherited.z};
    const trace=traceProjectile({origin,velocity,profile:pearlProfile,ticks:maxTicks,getBlock});
    if(trace.status!=='blocked'||!safeLanding(trace.collision,getBlock))continue;
    const time=trace.ticks,landing=trace.collision.point;
    if(time<2||time>maxTicks||landing.y<1)continue;
    candidates.push({yaw,pitch,ticks:time,landing,impactBlock:trace.collision.cell,score:time+Math.hypot(landing.x-origin.x,landing.z-origin.z)*.03});
  }
  return candidates.sort((a,b)=>a.score-b.score)[0]||null;
}

export function decideFallRescue(state,getBlock,inventory,{highestY=state?.position?.y,endermen=[]}={}){
  if(!state?.position||!state.velocity||state.onGround||state.gliding||state.frozen||state.gameMode===1||state.gameMode===3||state.velocity.y>-.16)return null;
  // A ladder's normal downward speed is 0.15 blocks/tick. The next physics
  // tick can report -0.225 just as the player enters it; this is not a fall.
  if(state.environment?.contacts?.some(name=>['ladder','vine','scaffolding'].includes(name)))return null;
  const landing=predictFallLanding(state,getBlock),height=landing?Math.max(highestY-state.position.y+landing.height,landing.height):Infinity;
  const lateralSpeed=Math.hypot(state.velocity.x||0,state.velocity.z||0);
  if(landing&&height>8&&state.dimension==='minecraft:the_end'&&lateralSpeed>.7&&(inventory?.ender_pearl||0)>0){
    const plan=planPearlEscape(state,getBlock,{endermen});
    if(plan)return {skill:'escapePearl',args:{},reason:"Strong lateral demolition in End: Transport to a confirmed island faster than fall.",plan};
  }
  if(landing&&height>4&&state.dimension!=='minecraft:the_nether'&&(inventory?.water_bucket||0)>0&&landing.ticks>=2)return {skill:'waterClutch',args:{},reason:"Place water before dangerous landing.",landing};
  if((!landing||height>Math.max(7,(state.health??20)-2))&&(inventory?.ender_pearl||0)>0){
    const plan=planPearlEscape(state,getBlock,{endermen});
    if(plan)return {skill:'escapePearl',args:{},reason:"empt or fatal fall: Throw pearls on a confirmed site.",plan};
  }
  return null;
}
