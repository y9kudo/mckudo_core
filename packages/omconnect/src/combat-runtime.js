import { setTimeout as delay } from 'node:timers/promises';
import { combatDecision, chooseWeapon, weaponProfile, shieldFaces, meleeGeometry,meleeRayIntersection } from './combat.js';
import { remainingDurability } from './equipment.js';
import { CombatPursuit, combatApproach } from './combat-navigation.js';
import { combatControl, safeCorridor } from './movement.js';
import { traceVisibility } from './visibility.js';

const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function combatGeometry(c,target) {
  return meleeGeometry(c.state,target,targetSize(c,target));
}
function targetSize(c,target) {
  const type=c.registry.entitiesByName[target.name];
  const pose=target.kind==='player'?({1:.6,2:.2,3:.6,4:.6,5:1.5})[target.metadata?.pose]:null;
  const scale=(target.metadata?.baby===true||target.metadata?.is_baby===true) ? .5 : 1;
  return {width:(type?.width??.6)*scale,height:pose??(type?.height??1.8)*scale};
}
function shield(c,enabled) {
  if(Boolean(c.guarding)===enabled)return;
  try {
    if(enabled)c.write('use_item',{hand:1,sequence:++c.sequence,rotation:{x:c.state.yaw,y:c.state.pitch}});
    else if(c.client?.state==='play')c.write('block_dig',{status:5,location:{x:0,y:0,z:0},face:0,sequence:++c.sequence});
  } finally {c.guarding=enabled;}
}

/** Reactive combat frame. Aiming and shield use never block tactical reassessment. */
export async function executeCombat(c,args,signal,{select,emptyHand,prepareShield}) {
  const duration=args.durationMs??400,maxDistance=args.maxDistance??12;
  if(!Number.isInteger(duration)||duration<50||duration>2000||!Number.isFinite(maxDistance)||maxDistance<1||maxDistance>32)throw new Error('combat: durationMs 50–2000 and maxDistance 1–32.');
  const target=c.entities.get(Number(args.entityId));
  if(!target||target.kind==='player'&&args.allowPlayer!==true)throw new Error('No authorized combat target.');
  let until;
  const alive=()=>{signal.throwIfAborted();if(c.state.health<=0||c.state.status!=='ready')throw new Error('Agent is unavailable.');};
  c.combatPursuit??=new CombatPursuit();
  const damage=e=>{if(e.entityId===String(target.id)&&e.sourceId===String(c.state.entityId))c.combatPursuit.damageConfirmed(e.receivedAt??performance.now());};
  c.on('damage',damage);
  let attacks=0,frames=0;
  try {
    if(c.inventory.items().some(i=>i.name==='shield'&&remainingDurability(i,c.registry)>0))await prepareShield(c,signal);
    until=performance.now()+duration;
    while(performance.now()<until) {
      alive();frames++;
      if(c.entities.get(Number(target.id))!==target)return {ok:true,targetGone:true,deathConfirmed:false,attacks,frames};
      if(distance(c.state.position,target.position)>maxDistance)throw new Error('Target moved beyond pursuit range.');
      const now=performance.now(),getBlock=p=>c.world.blockAt(p),geometry=combatGeometry(c,target);
      const eye={...c.state.position,y:c.state.position.y+1.62};
      const visible=traceVisibility({origin:eye,target:geometry.aim,getBlock,maxDistance:32}).visible;
      const blocking=shieldFaces(target,c.state.position);
      const avoidSweep=[...c.entities.values()].some(e=>e!==target&&e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(c.state.entityId)&&distance(e.position,target.position)<2);
      const weapon=chooseWeapon(c.inventory.items().filter(i=>remainingDurability(i,c.registry)>0),{shieldedTarget:blocking,avoidSweep});
      if(weapon&&c.inventory.held()?.slot!==weapon.slot){shield(c,false);await select(c,weapon,signal);continue;}
      else if(!weapon)await emptyHand(c,signal);
      if(c.combatJump){if(!c.state.onGround)c.combatJump.airborne=true;if(c.combatJump.target!==target.id||now>c.combatJump.until||c.combatJump.airborne&&c.state.onGround)c.combatJump=null;}
      const jumpKey=String(target.id)+'/'+(c.nextAttackAt||0);
      const crowded=[...c.entities.values()].some(e=>e!==target&&e.kind==='player'&&e.gameMode!==3&&String(e.id)!==String(c.state.entityId)&&distance(e.position,c.state.position)<1.2);
      const canJump=args.critical!==false&&weapon&&visible&&geometry.inReach&&c.state.health>12&&c.state.food>6&&c.state.onGround&&!c.guarding&&!crowded&&c.criticalAttempt!==jumpKey&&['x','z'].every(axis=>[-1,1].every(sign=>safeCorridor(c.state.position,{x:axis==='x'?sign:0,z:axis==='z'?sign:0},1,getBlock,{headroom:4})));
      const offhand=c.inventory.slots[45];
      let tactic=combatDecision({self:{...c.state,shield:offhand?.name==='shield'&&remainingDurability(offhand,c.registry)>0,shieldDisabledUntil:c.shieldDisabledUntil},target:{...target,blocking,charging:target.name==='blaze'&&Boolean(target.metadata?.flags&1)},projectiles:[...c.entities.values()].filter(e=>['arrow','small_fireball','fireball','trident'].includes(e.name)),geometry,visible,now,nextAttackAt:c.nextAttackAt||0,retreatHealth:args.retreatHealth??8,criticalPending:Boolean(c.combatJump),canCriticalJump:canJump});
      if(target.name==='enderman'&&getBlock(c.state.position)?.name==='water'&&['approach','strafe','jump'].includes(tactic.mode))tactic={...tactic,mode:'hold'};
      if(tactic.mode!=='retreat'){
        const pursuit=c.combatPursuit.observe({target,position:c.state.position,dimension:c.state.dimension,now,maxDistance});
        if(!pursuit.allowed)throw new Error(pursuit.reason);
      }
      c.combatDebug={target:String(target.id),mode:tactic.mode,reason:tactic.reason,reach:geometry.distance,visible,at:Date.now()};
      c.lookAt(tactic.guardPoint??geometry.aim,{signal,turnSpeed:720});
      shield(c,tactic.mode==='block');
      if(tactic.mode==='block'){c.combatJump=null;c.stopMovement();}
      else if(tactic.mode==='jump'){c.combatJump||={target:target.id,until:now+1500,airborne:false};c.criticalAttempt=jumpKey;c.control={x:0,z:0,jump:true,sprint:false};}
      else if(tactic.mode==='strike') {
        c.stopMovement();
        const hit=meleeRayIntersection(c.state,target,targetSize(c,target));
        // Check fresh reach/visibility every frame instead of waiting for a stale smooth-look target.
        if(hit&&traceVisibility({origin:eye,target:hit.point,getBlock,maxDistance:4}).visible&&!(avoidSweep&&weaponProfile(c.inventory.held()?.name).kind==='sword'&&!tactic.critical)){
          c.sendPosition();
          c.write('use_entity',{target:Number(target.id),mouse:1,sneaking:false});c.write('arm_animation',{hand:0});
          c.nextAttackAt=performance.now()+weaponProfile(c.inventory.held()?.name).cooldownMs;
          c.combatPursuit.attackSent(performance.now());c.combatJump=null;attacks++;
          c.emit('attackSent',{entityId:String(target.id),name:target.name,weapon:c.inventory.held()?.name||'hand',at:Date.now()});
        }
      } else if(['approach','retreat','strafe'].includes(tactic.mode)) {
        try {c.control=tactic.mode==='approach'?await combatApproach(c,target,signal):combatControl(c.state,target.position,tactic.mode,getBlock,{guarding:c.guarding,strafeSide:Math.floor(now/900)%2?-1:1});}
        catch(error){signal.throwIfAborted();if(error.code!=='STALE_WORLD')throw error;c.combatRoute=null;c.stopMovement();}
      } else c.stopMovement();
      await delay(25,undefined,{signal});
    }
    return {ok:true,frameFinished:true,attacks,frames};
  } finally {c.off('damage',damage);try{shield(c,false);}finally{c.stopMovement();}}
}
