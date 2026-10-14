import {dragonDecision} from './endgame.js';
import {isAir,isFullBlock,planRoute} from './navigation.js';
import {bridgeMaterials,solveAim,perchedDragonHead,traceVisibility} from '../omconnect/index.js';

const floor=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const act=(skill,args,reason,priority=100)=>({action:{skill,args},reason,priority});
const idle=reason=>({action:null,reason});

/** Native End policy: observed trajectories, reversible towers and cage openings. */
export function createDragonPolicy({client,maxTowerHeight=48}={}) {
  if(!client?.world||!Number.isInteger(maxTowerHeight)||maxTowerHeight<1||maxTowerHeight>64)throw new Error("Dragon policy: client and maxTowerHeight 1–64.");
  let tower=null,failures=0,lastReason="Wait End.";
  const openedCrystals=new Set(),pendingShots=new Map(),shotTicks=new Map();
  const block=p=>client.world.blockAt(p);
  const shot=(e,from=client.state.position)=>solveAim({origin:{...from,y:from.y+1.52},target:{...e.position,y:e.position.y+(client.registry.entitiesByName[e.name]?.height??2)/2},targetVelocity:e.velocity||{x:0,y:0,z:0},getBlock:block});
  const shootable=(e,from)=>shot(e,from).status==='aimed';
  const ownSupport=o=>client.pillarBlocks?.has(`${o.dimension}/${Math.floor(o.self.position.x)},${Math.round(o.self.position.y)-1},${Math.floor(o.self.position.z)}`);
  const cages=e=>{
    const p=floor(e.position),found=[];
    for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(let y=0;y<=3;y++){
      const b={x:p.x+x,y:p.y+y,z:p.z+z};if(block(b)?.name==='iron_bars')found.push(b);
    }return found;
  };
  const nearbyLadder=here=>{
    const foot=floor(here),found=[];
    for(let dx=-8;dx<=8;dx++)for(let dz=-8;dz<=8;dz++){
      const p={x:foot.x+dx,y:foot.y,z:foot.z+dz},b=block(p);
      if(b?.name!=='ladder')continue;
      const facing=b.getProperties?.().facing,dir={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]}[facing];if(!dir)continue;
      let top=p.y;while(top<p.y+16&&block({...p,y:top})?.name==='ladder')top++;
      const exit={x:p.x-dir[0],y:top,z:p.z-dir[1]};
      if(top<=p.y||!isFullBlock(block({...exit,y:top-1}))||!isAir(block(exit))||!isAir(block({...exit,y:top+1})))continue;
      found.push({p,d:Math.hypot(dx,dz)});
    }
    return found.sort((a,b)=>a.d-b.d)[0]?.p||null;
  };
  const perchedMelee=(dragon,here)=>{
    const head=perchedDragonHead(dragon);if(!head)return idle("The position of the dragon's head is not yet known.");
    const eye={...here,y:here.y+1.62};
    if(dist(eye,head)<3&&traceVisibility({origin:eye,target:head,getBlock:block,maxDistance:4}).visible)
      return act('attackDragon',{entityId:dragon.id,critical:true},"Hit the head with a sword on the dragon sitting down; Screams only when jumping safely.",800);
    const candidates=[];
    for(const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2],[2,2],[2,-2],[-2,2],[-2,-2]])for(let y=Math.floor(head.y)-3;y<=Math.floor(head.y);y++){
      const q={x:Math.floor(head.x+dx),y,z:Math.floor(head.z+dz)},center={x:q.x+.5,y:y+1.62,z:q.z+.5};
      const support=block({...q,y:y-1});
      if(!isFullBlock(support)||support.name==='end_portal'||support.name==='end_gateway'||!isAir(block(q))||!isAir(block({...q,y:y+1}))||dist(center,head)>=3)continue;
      if(!traceVisibility({origin:center,target:head,getBlock:block,maxDistance:4}).visible)continue;
      const route=planRoute({start:floor(here),goal:q,getBlock:block,maxNodes:3500,maxDistance:48,maxDrop:2,canDig:()=>false});
      if(route.status==='planned')candidates.push({q,cost:route.cost});
    }
    const best=candidates.sort((a,b)=>a.cost-b.cost)[0];
    return best?act('navigate',{...best.q,range:0,bridge:false,sprintJump:false},"Approach the head of the sitting dragon on the observed support.",600):idle("There is no safe approach to the head of the sitting dragon.");
  };
  const towerPlan=(e,o)=>{
    const available=bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block.fromStateId(id,0)}).reduce((n,b)=>n+b.count,0),here=floor(o.self.position),goalY=Math.floor(e.position.y);
    const options=[];
    for(const [dx,dz] of [[4,0],[-4,0],[0,4],[0,-4]])for(let dy=4;dy>=-8;dy--){
      const anchor={x:Math.floor(e.position.x)+dx,y:here.y+dy,z:Math.floor(e.position.z)+dz},height=goalY-anchor.y;
      if(height<0||height>maxTowerHeight||height>available||!isFullBlock(block({...anchor,y:anchor.y-1})))continue;
      if(!Array.from({length:height+4},(_,y)=>isAir(block({...anchor,y:anchor.y+y}))).every(Boolean))continue;
      const route=planRoute({start:here,goal:anchor,getBlock:block,maxNodes:4000,maxDistance:96,maxDrop:2});
      if(route.status==='planned')options.push({...anchor,height,cost:route.cost+height*3});
    }
    const anchor=options.sort((a,b)=>a.cost-b.cost)[0];
    return anchor?{entityId:e.id,anchor:{x:anchor.x,y:anchor.y,z:anchor.z},topY:goalY,mode:'approach',opened:0}:null;
  };
  const rangedTowerPlan=(e,o)=>{
    const available=bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block.fromStateId(id,0)}).reduce((n,b)=>n+b.count,0);
    const here=floor(o.self.position),goalY=Math.floor(e.position.y)-1,options=[];
    for(const radius of [18,24,30])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const x=Math.floor(e.position.x+dx*radius),z=Math.floor(e.position.z+dz*radius);
      for(let y=here.y+6;y>=here.y-8;y--){
        const anchor={x,y,z},height=goalY-y;
        if(height<3||height>maxTowerHeight||height>available||!isFullBlock(block({...anchor,y:y-1}))||!isAir(block(anchor))||!isAir(block({...anchor,y:y+1})))continue;
        if(!Array.from({length:height+3},(_,step)=>isAir(block({...anchor,y:y+step}))).every(Boolean))continue;
        const top={x:x+.5,y:goalY,z:z+.5};
        if(dist(top,e.position)<12||!shootable(e,top))continue;
        const route=planRoute({start:here,goal:anchor,getBlock:block,maxNodes:3000,maxDistance:96,maxDrop:2});
        if(route.status==='planned')options.push({anchor,topY:goalY,cost:route.cost+height*3});
        break;
      }
    }
    const best=options.sort((a,b)=>a.cost-b.cost)[0];
    return best?{entityId:e.id,anchor:best.anchor,topY:best.topY,mode:'approach',kind:'ranged',shots:0}:null;
  };
  const react=o=>{
    if(o.dimension!=='minecraft:the_end')return idle("Dragon fight is available in End.");
    const decision=dragonDecision(o),here=o.self.position;
    if(decision.mode==='completed')return null;
    // Finish dismantling the known tower before walking away or evading on its top.
    if(tower && (tower.mode==='descend' || failures>=2 || !o.entities.some(e=>e.id===tower.entityId))){
      if(ownSupport(o))return act('descendPillar',{count:1},"Return on your own support after opening the cell.");
      tower=null;failures=0;
    }
    const cloud=o.entities.find(e=>e.name==='area_effect_cloud'&&dist(e.position,here)<(e.radius||3)+2);
    if(cloud)return ownSupport(o)?act('descendPillar',{count:1},"Walk from your own support below the cloud.",1000):act('evade',{from:cloud.position},"Out of the air cloud.",1000);
    if(o.self.health<=8)return idle("We need to restore health before the fight continues.");
    if(tower){
      const e=o.entities.find(e=>e.id===tower.entityId);
      if(Math.hypot(here.x-tower.anchor.x-.5,here.z-tower.anchor.z-.5)>.2)return act('navigate',{...tower.anchor,range:0,bridge:false,sprintJump:false},"Approach the tested post.");
      if(here.y<tower.topY-.1){tower.mode='climb';return act('pillar',{count:1},"Go up to the grate one confirmed block.");}
      if(tower.kind==='ranged'){
        if(tower.mode==='waiting'&&Date.now()<(pendingShots.get(e.id)||0))return act('wait',{durationMs:250},"Wait for the crystal to hit the long pole.");
        if(tower.shots<3&&shootable(e,here)){
          const aim=shot(e,here);shotTicks.set(e.id,aim.ticks);
          return act('shoot',{entityId:e.id},"Shoot open crystal from a safe distance.");
        }
        tower.mode='descend';return ownSupport(o)?act('descendPillar',{count:1},"Return from the firing position after the verified shots."):idle("No own launch support found.");
      }
      const eye={...here,y:here.y+1.62},bars=cages(e).filter(p=>dist(eye,{x:p.x+.5,y:p.y+.5,z:p.z+.5})<4.2).sort((a,b)=>dist(eye,a)-dist(eye,b));
      // Remove an accessible near wall, never the crystal's supporting bedrock.
      if(bars.length && tower.opened<6)return act('dig',{...bars[0],block:'minecraft:iron_bars'},"Open the nearest side of the cell without impacting the crystal.");
      tower.mode='descend';return ownSupport(o)?act('descendPillar',{count:1},"Down before firing on the open crystal."):idle("To get away from the grate, you need a new support leg observation.");
    }
    if(decision.mode==='evade' && decision.target)return act('evade',{from:decision.target},decision.reason,950);
    if(decision.mode==='perch'){
      const dragon=o.entities.find(e=>e.id===decision.entityId);
      return dragon?perchedMelee(dragon,here):idle("The dragon sitting is no longer visible.");
    }
    const clearCrystals=o.entities.filter(e=>e.name==='end_crystal'&&dist(e.position,here)>=12&&Date.now()>=(pendingShots.get(e.id)||0))
      .map(e=>({e,aim:shot(e)})).filter(s=>s.aim.status==='aimed').sort((a,b)=>a.aim.ticks-b.aim.ticks);
    if(clearCrystals.length){
      const chosen=clearCrystals[0];shotTicks.set(chosen.e.id,chosen.aim.ticks);
      return act('shoot',{entityId:chosen.e.id},"Shoot a crystal with a proven trajectory.");
    }
    if(o.entities.some(e=>e.name==='end_crystal'&&Date.now()<(pendingShots.get(e.id)||0)))return act('wait',{durationMs:250},"Wait for the arrow to come out.");
    const e=o.entities.find(e=>e.id===decision.entityId);
    if(!e)return idle("Target not observed; The absence of a dragon does not prove victory.");
    if(!o.inventory['minecraft:bow']||!o.inventory['minecraft:arrow'])return idle("You need bow and arrows to fight.");
    if(shootable(e))return act('shoot',{entityId:e.id},decision.reason);
    const ladder=nearbyLadder(here);
    if(ladder)return act('climbLadder',ladder,"Go up the observed ladder to the island and open the review.");
    if(e.name==='end_crystal'){
      tower=rangedTowerPlan(e,o);
      if(tower)return act('navigate',{...tower.anchor,range:0,bridge:false,sprintJump:false},"Go to the safe far pole for firing.");
    }
    if(e.name==='end_crystal' && cages(e).length&&!openedCrystals.has(e.id)){
      tower=towerPlan(e,o);
      if(tower)return act('navigate',{...tower.anchor,range:0,bridge:false,sprintJump:false},"Prepare a reversible rise to closed crystal.");
    }
    // Try another ground firing position before spending blocks on a tower.
    const p=floor(here);
    for(const [dx,dz] of [[6,0],[-6,0],[0,6],[0,-6],[4,4],[-4,-4]]){
      const q={x:p.x+dx,y:p.y,z:p.z+dz},center={x:q.x+.5,y:q.y,z:q.z+.5};
      if(e.name==='end_crystal'&&dist(center,e.position)<12||!shootable(e,center))continue;
      if(planRoute({start:p,goal:q,getBlock:block,maxNodes:1500,maxDistance:16,maxDrop:1}).status==='planned')return act('navigate',{...q,range:0,bridge:false,sprintJump:false},"Change Position for Free Trace.");
    }
    // When the target is hidden beyond a rising slope, move toward it in
    // checked terrain stages. Each destination has confirmed support and A*.
    const vx=e.position.x-here.x,vz=e.position.z-here.z,len=Math.hypot(vx,vz)||1;
    for(const step of [16,12,8,4])for(const lateral of [0,2,-2,4,-4]){
      const x=Math.floor(here.x+vx/len*step-vz/len*lateral),z=Math.floor(here.z+vz/len*step+vx/len*lateral);
      for(let y=p.y+6;y>=p.y-3;y--){
        const q={x,y,z};if(!isAir(block(q))||!isAir(block({...q,y:y+1}))||!isFullBlock(block({...q,y:y-1})))continue;
        if(e.name==='end_crystal'&&dist({x:x+.5,y:y+1.62,z:z+.5},e.position)<12)continue;
        const route=planRoute({start:p,goal:q,getBlock:block,maxNodes:2500,maxDistance:24,maxDrop:2});
        if(route.status==='planned')return act('navigate',{...q,range:0,bridge:false,sprintJump:true},"Approaching the observed slope to the firing position.");
      }
    }
    return idle("No verified position for firing or lifting; Need a new field of observation.");
  };
  return {react(o){const result=react(o);lastReason=result?.reason||"The dragon's death confirmed.";return result;},recordResult(e,action){
    if(e.outcome==='failure'){failures++;if(action.skill==='shoot')pendingShots.delete(action.args.entityId);}
    else if(e.outcome==='success'){
      failures=0;
      if(tower&&action.skill==='dig'){tower.opened++;openedCrystals.add(tower.entityId);}
      if(tower?.kind==='ranged'&&action.skill==='shoot'&&String(action.args.entityId)===String(tower.entityId)){tower.shots++;tower.mode='waiting';}
      if(action.skill==='shoot')pendingShots.set(action.args.entityId,Date.now()+Math.max(1000,(shotTicks.get(action.args.entityId)||20)*50+800));
    }
  },snapshot:()=>({tower:tower?structuredClone(tower):null,failures,reason:lastReason,openedCrystals:[...openedCrystals],pendingShots:[...pendingShots]})};
}
