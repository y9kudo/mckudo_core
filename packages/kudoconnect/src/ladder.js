import {setTimeout as delay} from 'node:timers/promises';
import {isAir,isFullBlock} from './navigation.js';

const directions={north:{x:0,z:-1},south:{x:0,z:1},east:{x:1,z:0},west:{x:-1,z:0}};
const cell=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});

/** Climb a confirmed ladder and step onto a confirmed solid landing. */
export async function climbLadder(c,args,signal,{navigate}){
  const p=cell(args),limit=args.maxHeight??32;
  if(![p.x,p.y,p.z].every(Number.isFinite)||!Number.isInteger(limit)||limit<1||limit>32)throw new Error('climbLadder: x/y/z и maxHeight 1–32.');
  const base=c.world.blockAt(p),facing=base?.getProperties?.().facing,front=directions[facing];
  if(base?.name!=='ladder'||!front)throw new Error('В указанной точке нет наблюдаемой лестницы.');
  let top=p.y;while(top<p.y+limit&&c.world.blockAt({...p,y:top})?.name==='ladder'&&c.world.blockAt({...p,y:top})?.getProperties?.().facing===facing)top++;
  if(top===p.y+limit&&c.world.blockAt({...p,y:top})?.name==='ladder')throw new Error('Лестница выше проверенного бюджета.');
  const landing={x:p.x-front.x,y:top,z:p.z-front.z};
  if(!isFullBlock(c.world.blockAt({...landing,y:top-1}))||!isAir(c.world.blockAt(landing))||!isAir(c.world.blockAt({...landing,y:top+1}))||!isAir(c.world.blockAt({...p,y:top})))throw new Error('Сверху нет подтверждённой безопасной площадки.');
  const approach={x:p.x+front.x,y:p.y,z:p.z+front.z};
  if(!isFullBlock(c.world.blockAt({...approach,y:p.y-1}))||!isAir(c.world.blockAt(approach))||!isAir(c.world.blockAt({...approach,y:p.y+1})))throw new Error('У лестницы нет доступной нижней площадки.');
  if(c.state.health<=8||c.state.dimension==='minecraft:the_end'&&top>128)throw new Error('Недостаточно здоровья или высота небезопасна.');
  if(Math.hypot(c.state.position.x-approach.x-.5,c.state.position.z-approach.z-.5)>.7||Math.abs(c.state.position.y-p.y)>.2)await navigate(c,{...approach,range:0,bridge:false,sprintJump:false},signal);
  const corrections=c.metrics.corrections,until=Date.now()+Math.max(6000,(top-p.y)*1500);let phase='approach';
  const target={x:p.x+.5+front.x*.18,z:p.z+.5+front.z*.18};
  try{
    while(Date.now()<until){
      signal.throwIfAborted();if(c.state.status!=='ready'||c.state.health<=8||c.metrics.corrections-corrections>2)throw new Error('Подъём по лестнице прерван после изменения состояния.');
      const s=c.state.position;if(Math.abs(s.x-landing.x-.5)<.22&&Math.abs(s.z-landing.z-.5)<.22&&Math.abs(s.y-top)<.18&&c.state.onGround)return {ok:true,serverConfirmed:true,from:p,to:landing,height:top-p.y,corrections:c.metrics.corrections-corrections};
      phase=s.y>=top-.03?'exit':Math.floor(s.x)===p.x&&Math.floor(s.z)===p.z?'climb':'approach';
      const goal=phase==='exit'?{x:landing.x+.5,z:landing.z+.5}:target,dx=goal.x-s.x,dz=goal.z-s.z,d=Math.hypot(dx,dz);
      c.control={x:d>.04?dx/d*Math.min(1,d*2):0,z:d>.04?dz/d*Math.min(1,d*2):0,jump:phase==='climb',sprint:false,sneak:false};
      c.lookAt({x:landing.x+.5,y:top+1.4,z:landing.z+.5},{signal});
      await delay(25,undefined,{signal});
    }
    throw new Error(`Истёк бюджет подъёма по лестнице (${phase}).`);
  }finally{c.stopMovement();}
}
