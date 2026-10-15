import test from 'node:test';
import assert from 'node:assert/strict';
import { OMConnect } from '../index.js';
import { runAction } from '../src/actions.js';
import { meleeGeometry, meleeRayIntersection,combatDecision } from '../src/combat.js';
import { CombatPursuit } from '../src/combat-navigation.js';
import { gazeAngles } from '../src/players.js';

const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
function fixture({shield=false}={}) {
  const c=new OMConnect(),packets=[];
  Object.assign(c.state,{status:'ready',entityId:1,position:{x:.5,y:64,z:.5},velocity:{x:0,y:0,z:0},onGround:true,health:20,food:20,dimension:'minecraft:overworld'});
  c.world.blockAt=p=>p.y<64?stone:air;
  const target={id:'2',name:'zombie',position:{x:2.5,y:64,z:.5},metadata:{}};c.entities.set(2,target);
  c.initialDamageListeners=c.listenerCount('damage');
  const item=(name,slot)=>({name,type:c.registry.itemsByName[name].id,count:1,slot,raw:{components:[]}});
  c.inventory.slots[36]=item('iron_sword',36);if(shield)c.inventory.slots[45]=item('shield',45);
  c.client={state:'play',write:(name,data)=>packets.push({name,data,at:performance.now()}),end(){}};
  c.lookAt=p=>Object.assign(c.state,gazeAngles({...c.state.position,y:c.state.position.y+1.62},p));
  c.waitForLook=()=>assert.fail('Combat cannot await the end of an aim animation.');
  return {c,target,packets};
}

test('melee uses eye-to-volume reach and refuses targets above ordinary reach',()=>{
  const self={position:{x:0,y:64,z:0}};
  assert.equal(meleeGeometry(self,{position:{x:3.2,y:64,z:0}}).inReach,true);
  assert.equal(meleeGeometry(self,{position:{x:3.4,y:64,z:0}}).inReach,false);
  assert.equal(meleeGeometry(self,{position:{x:0,y:70,z:0}}).inReach,false);
  assert.equal(combatDecision({self:{...self,health:20},target:{position:{x:2,y:64,z:0}},visible:false}).mode,'approach');
});

test('a melee packet requires an actual ray intersection, including narrow and crouching targets',()=>{
  const self={position:{x:0,y:64,z:0},yaw:0,pitch:0},target={position:{x:0,y:64,z:3.1}};
  assert.ok(meleeRayIntersection(self,target));
  assert.equal(meleeRayIntersection({...self,yaw:6},target,{width:.2}),null);
  assert.equal(meleeRayIntersection(self,target,{height:1.5}),null);
  assert.ok(meleeRayIntersection({...self,pitch:8},target,{height:1.5}));
});
test('shield decisions face an incoming projectile rather than an unrelated melee target',()=>{
  const self={position:{x:0,y:64,z:0},health:20,shield:true};
  const arrow={position:{x:0,y:65,z:4},velocity:{x:0,y:0,z:-1}};
  const tactic=combatDecision({self,target:{position:{x:2,y:64,z:0}},projectiles:[arrow],now:1000});
  assert.equal(tactic.mode,'block');assert.deepEqual(tactic.guardPoint,arrow.position);
});

test('blocking is reassessed inside the frame and low health immediately releases the shield',async()=>{
  const {c,packets}=fixture({shield:true});c.nextAttackAt=performance.now()+1000;
  const began=performance.now();let retreatAt=null;
  const health=setTimeout(()=>{c.state.health=5;},80);
  const poll=setInterval(()=>{if(c.control.x<-.01)retreatAt??=performance.now();},5);
  try {
    await runAction(c,{skill:'combat',args:{entityId:'2',durationMs:250,critical:false}},AbortSignal.timeout(2000));
    assert.ok(packets.some(p=>p.name==='use_item'&&p.data.hand===1));
    const release=packets.find(p=>p.name==='block_dig'&&p.data.status===5);
    assert.ok(release);assert.ok(retreatAt!==null&&retreatAt-began<220,'health changes must not wait for a full guard action');
    assert.equal(c.guarding,false);assert.equal(c.control.x,0);assert.equal(c.listenerCount('damage'),c.initialDamageListeners);
  } finally {clearTimeout(health);clearInterval(poll);await c.close();}
});

test('charged sword cadence sends one hit rather than spamming and cleanup also runs on cancellation',async()=>{
  const {c,packets}=fixture();
  try {
    const result=await runAction(c,{skill:'combat',args:{entityId:'2',durationMs:200,critical:false}},AbortSignal.timeout(2000));
    assert.equal(result.attacks,1);assert.equal(packets.filter(p=>p.name==='use_entity').length,1);
    c.inventory.slots[45]={name:'shield',count:1,slot:45,raw:{components:[]}};
    await assert.rejects(runAction(c,{skill:'combat',args:{entityId:'2',durationMs:500,critical:false}},AbortSignal.timeout(80)),/abort|timeout/i);
    assert.equal(c.guarding,false);assert.equal(c.listenerCount('damage'),c.initialDamageListeners);assert.equal(c.control.x,0);
  } finally {await c.close();}
});

test('an opaque voxel blocks attacks even when the target is close',async()=>{
  const {c,packets}=fixture();c.world.blockAt=p=>p.y<64||Math.floor(p.x)===1&&Math.floor(p.y)===65?stone:air;
  try {
    await runAction(c,{skill:'combat',args:{entityId:'2',durationMs:100,critical:false}},AbortSignal.timeout(2000));
    assert.equal(packets.filter(p=>p.name==='use_entity').length,0);
  } finally {await c.close();}
});

test('sent attacks do not count as observed damage or keep an unsuccessful pursuit alive forever',()=>{
  const p=new CombatPursuit({maxChaseMs:1000}),target={id:'2',position:{x:2,y:64,z:0}},position={x:0,y:64,z:0};
  const observe=now=>p.observe({target,position,dimension:'world',now});
  assert.equal(observe(0).allowed,true);p.attackSent(500);assert.equal(observe(1001).allowed,false);
  p.damageConfirmed(1001);assert.equal(observe(1002).allowed,true);
});

test('confirmed exchanges move the pursuit anchor while packet-only attacks cannot extend the travel leash',()=>{
  const pursuit=new CombatPursuit(),target={id:'2',position:{x:2,y:64,z:0}};
  const observe=(x,now)=>{target.position.x=x+2;return pursuit.observe({target,position:{x,y:64,z:0},dimension:'arena',now,maxDistance:12});};
  assert.equal(observe(0,0).allowed,true);
  assert.equal(observe(20,500).allowed,true);pursuit.damageConfirmed(501);
  assert.equal(observe(40,1000).allowed,true);pursuit.damageConfirmed(1001);
  assert.equal(observe(60,1500).allowed,true);
  pursuit.attackSent(1501);assert.equal(observe(65,1600).allowed,false);
});
