import {setTimeout as delay} from 'node:timers/promises';
import {isAir,isFullBlock} from './navigation.js';
import {ensurePlanks,craft} from './crafting.js';
export const sleepTime=t=>Number.isInteger(t)&&t>=12541&&t<=23458;
const overworld=c=>{if(c.state.dimension!=='minecraft:overworld')throw new Error('Кровать используется только в обычном мире.');};
const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));

export async function prepareBed(c,args,signal,runtime){
  overworld(c);
  const found=await c.world.findBlocks({classes:['#beds'],position:c.state.position,radius:32,count:16,signal});
  for(const bed of found.blocks.filter(b=>!b.properties.occupied)){
    try{await runtime.approach(c,bed.position,signal);return {ok:true,position:bed.position,created:false};}catch{signal.throwIfAborted();}
  }
  let item=c.inventory.items().find(i=>i.name.endsWith('_bed'))?.name;
  if(!item){
    const wool=c.inventory.items().filter(i=>i.name.endsWith('_wool')).map(i=>i.name).find(n=>c.inventory.count(n)>=3);
    if(!wool)throw new Error('Для кровати нужны три блока шерсти одного цвета.');
    await ensurePlanks(c,3,signal,runtime);item=wool.replace(/_wool$/,'_bed');
    await craft(c,{item,count:1},signal,runtime);
  }
  const origin=floor(c.state.position),candidates=[];
  for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++)if(Math.hypot(dx,dz)>=1.5&&Math.hypot(dx,dz)<=3)candidates.push({x:origin.x+dx,y:origin.y,z:origin.z+dz});
  for(const p of candidates){
    signal.throwIfAborted();const yaw=Math.atan2(-(p.x+.5-c.state.position.x),p.z+.5-c.state.position.z)*180/Math.PI;
    const [dx,dz]=[[0,1],[-1,0],[0,-1],[1,0]][((Math.floor(yaw/90+.5)%4)+4)%4],head={x:p.x+dx,y:p.y,z:p.z+dz};
    const cells=[p,head];
    if(!cells.every(b=>isAir(c.world.blockAt(b))&&isAir(c.world.blockAt({...b,y:b.y+1}))&&isFullBlock(c.world.blockAt({...b,y:b.y-1}))))continue;
    if(cells.some(b=>[...c.entities.values(),{position:c.state.position}].some(e=>Math.abs(e.position.x-(b.x+.5))<.8&&Math.abs(e.position.z-(b.z+.5))<.8&&Math.abs(e.position.y-b.y)<2)))continue;
    await runtime.run(c,{skill:'select',args:{item}},signal);c.stopMovement();c.lookAt({x:p.x+.5,y:p.y-.1,z:p.z+.5});await c.waitForLook({signal});
    c.write('block_place',{hand:0,location:{...p,y:p.y-1},direction:1,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
    await c.waitFor(()=>cells.every(b=>c.world.blockAt(b)?.name===item),{signal,event:'block',timeoutMs:3000});
    return {ok:true,serverConfirmed:true,position:p,head,created:true};
  }
  throw new Error('Нет двух свободных безопасных клеток для кровати.');
}

export async function sleep(c,args,signal,runtime){
  overworld(c);if(!sleepTime(c.time.timeOfDay))throw new Error('Сейчас не время сна.');
  const maxWaitMs=args.maxWaitMs??10000;if(!Number.isInteger(maxWaitMs)||maxWaitMs<1000||maxWaitMs>30000)throw new Error('sleep.maxWaitMs: 1000–30000.');
  const prepared=args.x===undefined?await prepareBed(c,args,signal,runtime):{position:floor(args)};
  // A usable block may be in click reach but outside the server's stricter sleep range.
  await runtime.run(c,{skill:'navigate',args:{...prepared.position,range:1,bridge:false,sprintJump:false}},signal);
  const bed=c.world.blockAt(prepared.position);if(!bed?.name.endsWith('_bed')||bed.getProperties().occupied)throw new Error('Кровать исчезла или занята.');
  c.stopMovement();c.lookAt({x:prepared.position.x+.5,y:prepared.position.y+.5,z:prepared.position.z+.5});await c.waitForLook({signal});
  c.write('block_place',{hand:0,location:prepared.position,direction:1,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
  try{
    await c.waitFor(()=>c.state.sleeping,{event:'sleep',signal,timeoutMs:3000});
    const until=Date.now()+maxWaitMs;while(c.state.sleeping&&Date.now()<until)await delay(100,undefined,{signal});
    return {ok:true,sleepConfirmed:true,nightSkipped:!sleepTime(c.time.timeOfDay),position:prepared.position};
  }finally{
    if(c.state.sleeping&&c.client.state==='play'){c.write('entity_action',{entityId:c.state.entityId,actionId:'stop_sleeping',jumpBoost:0});await c.waitFor(()=>!c.state.sleeping,{event:'wake',timeoutMs:3000}).catch(()=>{});}
  }
}
