import {predictElytraTick,traceVolume,elytraControl} from './vectorize.js';
import {remainingDurability} from './equipment.js';

function steer(c,yaw,pitch){
  const y=yaw*Math.PI/180,p=pitch*Math.PI/180;
  c.lookAt({x:c.state.position.x-Math.sin(y)*Math.cos(p)*40,y:c.state.position.y+1.62-Math.sin(p)*40,z:c.state.position.z+Math.cos(y)*Math.cos(p)*40},{turnSpeed:360});
}
export async function executeFly(c,args,signal,{run,select}){
  const goal=args.position||args,timeoutMs=args.timeoutMs??45000,maxRockets=args.maxRockets??3;
  if(!Number.isInteger(timeoutMs)||timeoutMs<3000||timeoutMs>120000||!Number.isInteger(maxRockets)||maxRockets<1||maxRockets>16)throw new Error('fly: timeoutMs 3000–120000, maxRockets 1–16.');
  if(c.containers.current||c.inventory.cursor||c.state.vehicleId!=null)throw new Error("Close the window before you fly and get out of transport.");
  const elytra=[c.inventory.slots[6],...c.inventory.items()].find(i=>i?.name==='elytra'&&remainingDurability(i,c.registry)>16);
  const rocket=c.inventory.items().find(i=>i.name==='firework_rocket'&&!(i.raw.components?.find(v=>v.type==='fireworks')?.data?.explosions?.length));
  if(!elytra||!rocket)throw new Error("Flying requires good elites and fireworks without explosive stars.");
  const plan=c.vectorize.planFlight({start:c.state.position,goal,cruiseHeight:args.cruiseHeight??16,maxDistance:args.maxDistance??192});
  if(plan.status!=='planned')throw new Error(`Flight corridor: ${plan.reason}.`);
  if(!c.state.onGround)throw new Error("fly: Start with the observed ground.");
  await run(c,{skill:'equipArmor',args:{item:'elytra'}},signal);await select(c,rocket,signal);
  const start={...c.state.position},health=c.state.health,initialEvidence={...c.flightEvidence},initialRockets=c.inventory.count('firework_rocket'),corrections=c.metrics.corrections;
  const until=Date.now()+timeoutMs;let used=0,landed=false,maxY=start.y,travelled=0,previous=start;
  const boost=async()=>{
    const before=c.inventory.count('firework_rocket'),evidence=c.flightEvidence.rockets;
    if(used>=maxRockets||!c.inventory.held()||c.inventory.held().name!=='firework_rocket'||before<1)throw new Error("The fireworks budget has been exhausted.");
    c.write('use_item',{hand:0,sequence:++c.sequence,rotation:{x:c.state.yaw,y:c.state.pitch}});
    await c.waitFor(()=>c.inventory.count('firework_rocket')<before&&c.flightEvidence.rockets>evidence,{signal,event:'physics',timeoutMs:2500});used++;
  };
  c.stopMovement();steer(c,Math.atan2(start.x-plan.landing.x,plan.landing.z-start.z)*180/Math.PI,-45);await c.waitForLook?.({signal});
  try{
    c.control.jump=true;
    await c.waitFor(()=>!c.state.onGround&&c.state.velocity.y<0,{signal,timeoutMs:1800});c.control.jump=false;
    c.write('entity_action',{entityId:c.state.entityId,actionId:'start_fall_flying',jumpBoost:0});
    await c.waitFor(()=>c.state.gliding,{signal,event:'selfMetadata',timeoutMs:1500});
    await boost();
    while(Date.now()<until){
      signal.throwIfAborted();if(c.state.health<=0||c.state.status!=='ready')throw new Error("Agent is not available during flight.");
      const p=c.state.position;maxY=Math.max(maxY,p.y);travelled+=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);previous={...p};
      if(c.state.onGround&&!c.state.gliding){landed=true;break;}
      if(c.metrics.corrections-corrections>3)throw new Error("The server re-corrects the flight.");
      const command=elytraControl({position:p,velocity:c.state.velocity,landing:plan.landing,altitude:plan.altitude,boosting:c.state.rocketBoost});
      c.state.flightPhase=command.phase;steer(c,command.yaw,command.pitch);
      // Forecast actual momentum, not just the direction of the target.
      let future={position:{...p},velocity:{...c.state.velocity},yaw:c.state.yaw,pitch:c.state.pitch};
      for(let i=0;i<6;i++){
        const next=predictElytraTick({...future,rocket:c.state.rocketBoost});
        const check=traceVolume({from:future.position,to:next.position,getBlock:q=>c.world.blockAt(q),height:.6});
        if(!check.clear){
          const nearLanding=command.remaining<8&&p.y-plan.landing.y<3&&check.reason==='collision';
          if(!nearLanding){steer(c,command.yaw,-65);if(check.reason==='unloaded'||check.reason==='hazard')throw new Error("Unknown area or hazard ahead.");}
          break;
        }
        future=next;
      }
      if(!c.state.rocketBoost&&command.remaining>Math.max(35,(p.y-plan.landing.y)*3)&&p.y<plan.altitude-5&&used<maxRockets)await boost();
      const tick=c.tickTiming.snapshot().ticks;
      await c.waitFor(()=>c.tickTiming.snapshot().ticks>tick,{signal,timeoutMs:1000});
    }
    if(!landed)throw new Error("The flight did not complete the landing within the time limit.");
    await c.waitFor(()=>!(c.selfMetadata.shared_flags&128),{signal,event:'selfMetadata',timeoutMs:2000});
    const error=Math.hypot(c.state.position.x-plan.landing.x,c.state.position.z-plan.landing.z);
    if(error>8)throw new Error(`Landing outside the site: ${error.toFixed(1)} blocks.`);
    const foot=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(c.state.position[k])]));
    const support=c.world.blockAt({...foot,y:foot.y-1}),clear=c.vectorize.clearance(c.state.position);
    if(!clear.clear||!support||!(support.shapes?.some(s=>s[4]===1)||support.boundingBox==='block')||/^(?:lava|magma_block|cactus|fire|soul_fire)$/.test(support.name))throw new Error("Place of actual landing not confirmed by safe.");
    return {ok:true,serverConfirmed:true,start,position:{...c.state.position},landing:plan.landing,landingError:error,maxY,travelled,rocketsUsed:initialRockets-c.inventory.count('firework_rocket'),takeoffs:c.flightEvidence.takeoffs-initialEvidence.takeoffs,attachedRockets:c.flightEvidence.rockets-initialEvidence.rockets,healthBefore:health,healthAfter:c.state.health,corrections:c.metrics.corrections-corrections};
  }finally{
    c.control.jump=false;c.state.flightPhase=landed?'landed':'interrupted';
    // A cancelled controller cannot freeze a flying player. Flare without more rockets.
    if(c.state.gliding&&c.state.health>0&&!c.connectionAbort.signal.aborted){
      c.cancelLook();steer(c,c.state.yaw,-78);
      try{await c.waitFor(()=>c.state.onGround&&!c.state.gliding,{signal:AbortSignal.any([c.connectionAbort.signal,AbortSignal.timeout(20000)]),timeoutMs:20000});}catch{}
    }
    c.stopMovement();
  }
}
