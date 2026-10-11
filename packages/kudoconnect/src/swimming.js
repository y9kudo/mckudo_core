import { KudoVectorize, traceVolume } from './vectorize.js';
import { fluidAt } from './environment.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export async function executeSwim(c,args,signal){
  const goal=args.position || {x:args.x,y:args.y,z:args.z};
  const air=c.selfMetadata.air_supply ?? 300;
  const vector=new KudoVectorize({getBlock:p=>c.world.blockAt(p),getRevision:()=>c.world.revision});
  const plan=await vector.planAsync({start:c.state.position,goal,airTicks:Math.max(0,Math.min(300,Number(air))),maxDistance:args.maxDistance??64,maxNodes:args.maxNodes??6000,signal});
  if(plan.status!=='planned')throw new Error(`Плавание: ${plan.reason}.`);
  const deadline=Date.now()+Math.min(120000,Math.max(5000,plan.cost*3000));
  try{
    for(const target of plan.waypoints.slice(1)){
      await c.waitFor(()=>{
        signal.throwIfAborted();
        if(Date.now()>deadline)throw new Error('Плавание: превышен бюджет времени.');
        if(c.state.health<=0)throw new Error('Агент погиб при плавании.');
        const head={...c.state.position,y:c.state.position.y+1.62};
        if((c.selfMetadata.air_supply??300)<=60&&fluidAt(c.world.blockAt(head))?.kind==='water')throw new Error('Плавание остановлено: недостаточно воздуха.');
        const p=c.state.position,dx=target.x-p.x,dz=target.z-p.z,dy=target.y-p.y,h=Math.hypot(dx,dz);
        if(distance(p,target)<.38)return true;
        if(!traceVolume({from:p,to:target,getBlock:q=>c.world.blockAt(q)}).clear)throw new Error('Плавание: проход изменился, нужен новый маршрут.');
        c.lookAt({...target,y:target.y+1.1},{signal});
        c.control={x:h>.12?dx/h*Math.min(1,h*2):0,z:h>.12?dz/h*Math.min(1,h*2):0,jump:dy>.1,sneak:dy<-.1,sprint:false};
        return false;
      },{signal,event:'physics',timeoutMs:Math.max(1000,deadline-Date.now())});
    }
    return {ok:true,mode:'swim',position:{...c.state.position},visited:plan.visited};
  }finally{c.stopMovement();}
}
