import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityMotion, entityPrediction } from '../src/entity-motion.js';
import { AimTracking } from '../src/aim-tracking.js';
import { CombatLoadout, flankSide } from '../src/combat-tactics.js';
import { solveAim, traceProjectile } from '../src/projectiles.js';
import { SmoothLook, combatControl, wrapDegrees } from '../src/movement.js';
import { CombatPursuit } from '../src/combat-navigation.js';
import { OMConnect } from '../index.js';
import { runAction } from '../src/actions.js';
import { gazeAngles } from '../src/players.js';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const flat=p=>p.y<1?stone:air;
const entity=()=>({id:'2',kind:'player',name:'player',onGround:true,position:{x:20,y:1,z:0},velocity:{x:0,y:0,z:0},metadata:{}});

test('protocol movement feeds the aim estimator; teleports reset it and damage preserves direct projectile attribution',async()=>{
  const protocol=new EventEmitter();protocol.state='play';protocol.write=()=>{};protocol.end=()=>protocol.emit('end');
  const c=new OMConnect({connectTimeoutMs:1000},{createProtocolClient:()=>protocol});c.world.columnAt=()=>({});c.world.blockAt=flat;
  try{
    const connecting=c.connect();protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});
    protocol.emit('position',{x:0,y:1,z:0,yaw:0,pitch:0,flags:0,teleportId:1});protocol.emit('update_health',{health:20,food:20});await connecting;c.stopClock();
    protocol.emit('spawn_entity',{entityId:2,type:c.registry.entitiesByName.player.id,x:10,y:1,z:0,yaw:0,pitch:0,velocity:{x:0,y:0,z:0}});
    const e=c.entities.get(2);await delay(55);protocol.emit('rel_entity_move',{entityId:2,dX:0,dY:0,dZ:1024,onGround:true});
    assert.ok(c.entityMotion.sample(e).velocity.z>.1);assert.equal(e.onGround,true);
    protocol.emit('entity_teleport',{entityId:2,x:50,y:1,z:0,onGround:true});assert.equal(c.entityMotion.sample(e).velocity.z,0);
    protocol.emit('spawn_entity',{entityId:42,type:c.registry.entitiesByName.arrow.id,objectData:1,x:0,y:2.52,z:0,yaw:0,pitch:0,velocity:{x:0,y:0,z:8000}});
    assert.equal(c.entities.get(42).ownerId,1,'native 1.21 spawn data carries the actual owner ID, without a damage-event offset');
    e.yaw=90;e.equipment={1:{name:'shield'}};e.metadata.living_entity_flags=3;
    const seen=c.observe();assert.equal(seen.entities.find(e=>e.id==='2').blocking,true);assert.equal(seen.entities.find(e=>e.id==='42').velocity.z,1);
    let damage;c.once('damage',e=>damage=e);protocol.emit('damage_event',{entityId:2,sourceCauseId:2,sourceDirectId:43});
    assert.equal(damage.sourceId,'1');assert.equal(damage.directId,'42');
    let blocked;c.once('shieldBlock',e=>blocked=e);protocol.emit('entity_status',{entityId:1,entityStatus:29});assert.equal(blocked.serverConfirmed,true);
  }finally{await c.close();}
});

test('position snapshots provide lead without velocity packets; stops, stalls and teleports clear stale lead',()=>{
  const motion=new EntityMotion(),e=entity();motion.observe(e,{now:0});
  for(let i=1;i<=5;i++){e.position.z=i*.28;motion.observe(e,{now:i*50});}
  assert.ok(Math.abs(motion.sample(e,250).velocity.z-.28)<.001);
  assert.equal(e.velocity.z,0,'raw packet velocity is not the measured player motion');
  motion.observe(e,{now:300});assert.equal(motion.sample(e,300).velocity.z,0);
  e.position.z+=.28;motion.observe(e,{now:350});assert.ok(motion.sample(e,350).velocity.z>.2);
  assert.equal(motion.sample(e,800).velocity.z,0);
  e.position.x=200;motion.observe(e,{now:400,teleport:true});assert.equal(motion.sample(e,400).velocity.x,0);
  e.position.x+=30;motion.observe(e,{now:450});assert.equal(motion.sample(e,450).velocity.x,0);
});

test('TCP bursts coalesce rather than becoming enormous velocities, and entity ID reuse does not inherit motion',()=>{
  const motion=new EntityMotion(),e=entity();motion.observe(e,{now:0});
  e.position.z=.14;motion.observe(e,{now:1});e.position.z=.28;motion.observe(e,{now:50});
  assert.ok(Math.abs(motion.sample(e,50).velocity.z-.28)<.001);
  const replacement=entity();assert.equal(motion.sample(replacement,50).velocity.z,0);
});

test('jump interception follows gravity and a known floor instead of extrapolating upward indefinitely',()=>{
  const e=entity();e.onGround=false;e.position.y=2;
  const velocity={x:0,y:.25,z:.15},predictTarget=entityPrediction(e,{velocity,getBlock:flat});
  const solution=solveAim({origin:{x:0,y:2.52,z:0},target:{...e.position,y:2.9},targetVelocity:velocity,predictTarget,getBlock:flat});
  assert.equal(solution.status,'aimed');
  let y=2,vy=.25;
  const ys=[y];for(let t=1;t<=Math.ceil(solution.ticks);t++){y=Math.max(1,y+vy);vy=y===1?0:(vy-.08)*.98;ys.push(y);}
  const n=Math.floor(solution.ticks),f=solution.ticks-n,expectedY=ys[n]+(ys[n+1]-ys[n])*f+.9;
  const trace=traceProjectile({origin:{x:0,y:2.52,z:0},velocity:solution.velocity,ticks:solution.ticks,getBlock:flat});
  assert.equal(trace.status,'clear');assert.ok(Math.abs(trace.position.y-expectedY)<.001);
  assert.ok(Math.abs(trace.position.z-.15*solution.ticks)<.001);
  assert.ok(Math.abs(solution.predicted.y-(2.9+.25*solution.ticks))>.5);
  assert.equal(predictTarget(30).y,1.9);
  assert.throws(()=>entityPrediction(e,{velocity:{x:1e8,y:0,z:0},getBlock:flat}),/bounded/);
  assert.throws(()=>solveAim({origin:e.position,target:e.position,getBlock:flat,predictTarget:()=>({x:NaN,y:0,z:0})}),/finite/);
});

test('angular tracking follows a strafing target across yaw wrap using ordinary smooth rotation',()=>{
  const state={position:{x:0,y:1,z:0},yaw:170,pitch:0},look=new SmoothLook(),tracker=new AimTracking(),signal=new AbortController().signal;
  const c={state,lookAt:(p,options)=>{assert.notEqual(options.immediate,true);look.set(state,p,options);}};
  let maxError=0;
  for(let i=0;i<=80;i++){
    const yaw=wrapDegrees(170+i*.75);
    tracker.update(c,{yaw,pitch:0},signal,i*25);look.tick(state,.025);
    if(i>20)maxError=Math.max(maxError,Math.abs(wrapDegrees(yaw-state.yaw)));
  }
  assert.ok(maxError<.6,`continuous 30 degrees/second tracking error: ${maxError}`);
});

test('shield flickering cannot indefinitely reset the selected axe, and expired commitments can return to a sword',()=>{
  const loadout=new CombatLoadout(),target=entity(),sword={name:'diamond_sword',slot:36},axe={name:'diamond_axe',slot:37},items=[sword,axe];
  assert.equal(loadout.choose(target,items,sword,{now:0,shieldedTarget:true}),axe);loadout.selected(target,axe,0);
  for(let now=25;now<1175;now+=25)assert.equal(loadout.choose(target,items,axe,{now,shieldedTarget:now%100<50}),axe);
  assert.equal(loadout.choose(target,items,axe,{now:1175,shieldedTarget:false}),sword);
  assert.equal(loadout.choose(entity(),items,axe,{now:100,shieldedTarget:false}),sword);
  assert.equal(loadout.choose(target,[sword],axe,{now:100,shieldedTarget:false}),sword,'a missing/broken weapon cannot be retained');
});

test('the combat executor lands a charged axe attempt despite a shield toggled every fifty milliseconds',async()=>{
  const c=new OMConnect(),e=entity(),attacks=[],packets=[];e.position={x:2.5,y:1,z:.5};e.yaw=90;e.equipment={1:{name:'shield'}};e.metadata.living_entity_flags=3;
  Object.assign(c.state,{status:'ready',entityId:1,health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5},dimension:'minecraft:overworld'});c.entities.set(2,e);c.world.blockAt=flat;
  for(const [slot,name]of [[36,'diamond_sword'],[37,'diamond_axe']])c.inventory.slots[slot]={name,type:c.registry.itemsByName[name].id,count:1,slot,raw:{components:[]}};
  c.client={state:'play',write:(name,p)=>packets.push({name,p,at:performance.now()}),end(){}};
  c.lookAt=p=>Object.assign(c.state,gazeAngles({...c.state.position,y:2.62},p));
  c.on('attackSent',e=>attacks.push({...e,elapsed:performance.now()-began}));
  const toggles=setInterval(()=>e.metadata.living_entity_flags=e.metadata.living_entity_flags?0:3,50),began=performance.now();
  try{
    await runAction(c,{skill:'combat',args:{entityId:'2',allowPlayer:true,critical:false,durationMs:1400}},AbortSignal.timeout(4000));
    assert.ok(attacks.length>=1);assert.equal(attacks[0].weapon,'diamond_axe');assert.ok(attacks[0].elapsed>=990);
    assert.equal(packets.filter(p=>p.name==='held_item_slot'&&p.at<began+attacks[0].elapsed).length,1);
  }finally{clearInterval(toggles);await c.close();}
});

test('spacing and shield flanks are directional and never select unsupported movement',()=>{
  const self={position:{x:.5,y:1,z:2},onGround:true,health:20,food:20},target={position:{x:0,y:1,z:0},yaw:0};
  const side=flankSide(self,target);assert.equal(side,-1);
  const control=combatControl(self,target.position,'strafe',flat,{strafeSide:side,spacing:2.8});
  assert.ok(control.x>0&&control.z>0,'flank and backstep instead of crowding a raised shield');
  const edge=p=>p.y<1&&p.z<=2&&p.x===0?stone:air;
  const stopped=combatControl({...self,position:{x:.5,y:1,z:.5}},target.position,'strafe',edge,{spacing:2.8});
  assert.equal(stopped.x,0);assert.equal(stopped.z,0);
  const pursuit=new CombatPursuit({stuckMs:100}),opponent={position:{x:3.1,y:1,z:0}};
  assert.equal(pursuit.observe({target:opponent,position:{x:0,y:1,z:0},now:0,inReach:true}).allowed,true);
  assert.equal(pursuit.observe({target:opponent,position:{x:0,y:1,z:0},now:101,inReach:true}).allowed,true);
});

test('a full bow draw tracks real snapshot motion and releases one aligned projectile without waiting for look completion',async()=>{
  const c=new OMConnect(),e=entity(),packets=[];e.position.x=14;e.position.z=0;
  Object.assign(c.state,{status:'ready',entityId:1,health:20,food:20,onGround:true,position:{x:0,y:1,z:0},velocity:{x:0,y:0,z:0},dimension:'minecraft:overworld'});
  c.entities.set(2,e);c.world.blockAt=flat;c.entityMotion.observe(e);
  for(const [slot,name,count]of [[36,'bow',1],[37,'arrow',64]])c.inventory.slots[slot]={name,type:c.registry.itemsByName[name].id,count,slot,raw:{components:[]}};
  c.waitForLook=()=>assert.fail('A moving shot must not await a stale look target.');
  c.client={state:'play',write(name,p){packets.push({name,p});if(name==='block_dig'&&p.status===5)c.inventory.slots[37].count--;},end(){}};
  const motion=setInterval(()=>{e.position.z+=.12;c.entityMotion.observe(e);},50);
  try{
    const result=await runAction(c,{skill:'shoot',args:{entityId:'2',allowPlayer:true}},AbortSignal.timeout(4000));
    assert.equal(result.shotServerConfirmed,true);assert.equal(result.hitConfirmed,false);
    assert.equal(packets.filter(p=>p.name==='block_dig'&&p.p.status===5).length,1);
    assert.equal(c.aimDebug.stage,'released');assert.ok(c.aimDebug.velocity.z>.08);
    assert.ok(c.aimDebug.predicted.z>e.position.z+.3);
    assert.ok(c.aimDebug.angularError<=c.aimDebug.tolerance);
    const yaw=c.state.yaw*Math.PI/180,pitch=c.state.pitch*Math.PI/180;
    const trace=traceProjectile({origin:{x:0,y:2.52,z:0},velocity:{x:-3*Math.sin(yaw)*Math.cos(pitch),y:-3*Math.sin(pitch),z:3*Math.cos(yaw)*Math.cos(pitch)},ticks:result.flightTicks,getBlock:flat});
    assert.equal(trace.status,'clear');assert.ok(Math.hypot(trace.position.x-14,trace.position.y-1.9,trace.position.z-(e.position.z+.12*result.flightTicks))<.35);
  }finally{clearInterval(motion);await c.close();}
});
