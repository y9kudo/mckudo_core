import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {shieldThreat} from '../src/shield-threats.js';
import {EntityMotion} from '../src/entity-motion.js';
import {OMConnect} from '../index.js';
import {runAction} from '../src/actions.js';
import {gazeAngles} from '../src/players.js';

const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const flat=p=>p.y<1?stone:air;
const self={entityId:1,position:{x:0,y:1,z:0},velocity:{x:0,y:0,z:0},health:20};
const arrow=()=>({id:'42',name:'arrow',position:{x:0,y:2,z:12},velocity:{x:0,y:0,z:-2},ownerId:2});

test('shield prediction selects real body intersections, ignores own arrows and misses, and respects walls',()=>{
  const e=arrow(),threat=shieldThreat(self,[e],{getBlock:flat});assert.ok(threat);assert.ok(threat.ticks>5&&threat.ticks<7);
  assert.equal(shieldThreat(self,[{...e,ownerId:1}]),null);
  assert.equal(shieldThreat(self,[{...e,velocity:{x:0,y:0,z:2}}]),null);
  assert.equal(shieldThreat(self,[{...e,position:{...e.position,x:2}}]),null);
  assert.equal(shieldThreat(self,[e],{getBlock:p=>p.z===6?stone:flat(p)}),null);
  assert.equal(shieldThreat(self,[{...e,velocity:{x:0,y:0,z:0}}]),null);
  assert.equal(shieldThreat(self,[{...e,position:{x:0,y:2,z:10},velocity:{x:0,y:0,z:-1}}]),null,'gravity carries a low, slow arrow below the body before it arrives');
});

test('an aimed drawing bow raises an anticipatory threat before an arrow exists, without assuming every bow is aimed',()=>{
  const shooter={id:'2',name:'player',position:{x:0,y:1,z:12},yaw:180,pitch:0,metadata:{living_entity_flags:1},equipment:{0:{name:'bow'}}};
  assert.equal(shieldThreat(self,[shooter],{getBlock:flat}).anticipating,true);
  assert.equal(shieldThreat(self,[{...shooter,yaw:90}],{getBlock:flat}),null);
  assert.equal(shieldThreat(self,[{...shooter,metadata:{living_entity_flags:0}}]),null);
});

test('sparse arrow snapshots advance with gravity in the defensive read view and stop at a known wall',()=>{
  const motion=new EntityMotion(),e=arrow();motion.observe(e,{now:0});
  const predicted=motion.projectile(e,{now:200,getBlock:flat});
  assert.ok(predicted.position.z<5);assert.ok(predicted.velocity.y<0);assert.equal(e.position.z,12,'received state remains unchanged');
  const wall=motion.projectile(e,{now:200,getBlock:p=>p.z===8?stone:flat(p)});
  assert.equal(wall.velocity.z,0);assert.equal(shieldThreat(self,[wall]),null);
  assert.equal(motion.projectile(e,{now:1600,getBlock:flat}).velocity.z,0,'unobserved old projectiles cannot hold guard forever');
});

function fixture(){
  const c=new OMConnect(),packets=[];Object.assign(c.state,{...self,status:'ready',food:20,onGround:true,dimension:'minecraft:overworld'});
  c.world.blockAt=flat;c.entities.set(42,arrow());c.inventory.slots[45]={name:'shield',type:c.registry.itemsByName.shield.id,count:1,slot:45,raw:{components:[]}};
  c.client={state:'play',write:(name,p)=>packets.push({name,p,at:performance.now()}),end(){}};
  c.lookAt=p=>Object.assign(c.state,gazeAngles({...c.state.position,y:2.62},p));return {c,packets};
}
test('reactive guard raises once promptly, follows the arrow and releases shortly after danger disappears',async()=>{
  const {c,packets}=fixture(),began=performance.now(),gone=setTimeout(()=>c.entities.delete(42),150);
  try{
    const result=await runAction(c,{skill:'guard',args:{reactive:true,durationMs:1500}},AbortSignal.timeout(2500));
    const use=packets.filter(p=>p.name==='use_item'),release=packets.filter(p=>p.name==='block_dig'&&p.p.status===5);
    assert.equal(use.length,1);assert.equal(release.length,1);assert.ok(use[0].at-began<100);
    assert.equal(result.threatCleared,true);assert.ok(release[0].at-began<500);assert.ok(Math.abs(c.shieldDebug.estimatedActiveAt-c.shieldDebug.raisedAt-250)<1e-6);
    assert.equal(c.guarding,false);assert.equal(c.look.target,null);assert.equal(c.control.sprint,false);
  }finally{clearTimeout(gone);await c.close();}
});
test('reactive guard releases on cancellation and on a server shield cooldown without leaving controls active',async()=>{
  const {c,packets}=fixture();
  try{
    await assert.rejects(runAction(c,{skill:'guard',args:{reactive:true}},AbortSignal.timeout(70)),/abort|timeout/i);
    assert.equal(c.guarding,false);assert.ok(packets.some(p=>p.name==='block_dig'&&p.p.status===5));
    const cooldown=setTimeout(()=>c.shieldDisabledUntil=performance.now()+1000,50);
    try{const result=await runAction(c,{skill:'guard',args:{reactive:true}},AbortSignal.timeout(1000));assert.equal(result.shieldDisabled,true);assert.equal(c.guarding,false);}finally{clearTimeout(cooldown);}
    await delay(1);assert.equal(c.control.x,0);
  }finally{await c.close();}
});
