import test from 'node:test';
import assert from 'node:assert/strict';
import {combatDecision,chooseWeapon,shieldFaces} from '../src/combat.js';
import {OMConnect} from '../index.js';
import {readSlot} from '../src/inventory.js';

const self={position:{x:0,y:1,z:0},health:20,food:20,onGround:true,velocity:{x:0,y:0,z:0}},target={position:{x:2,y:1,z:0},name:'player'};
test('a carried shield is not blocking while eating; its facing controls axe selection',()=>{
  const e={position:{x:0,y:1,z:0},yaw:0,equipment:{0:{name:'apple'},1:{name:'shield'}},metadata:{living_entity_flags:1}};
  assert.equal(shieldFaces(e,{x:0,y:1,z:2}),false);
  e.metadata.living_entity_flags=3;
  assert.equal(shieldFaces(e,{x:0,y:1,z:2}),true);assert.equal(shieldFaces(e,{x:0,y:1,z:-2}),false);
  const items=[{name:'diamond_sword'},{name:'stone_axe'}];assert.equal(chooseWeapon(items,{shieldedTarget:true}).name,'stone_axe');assert.equal(chooseWeapon(items,{avoidSweep:true}).name,'stone_axe');assert.equal(chooseWeapon(items).name,'diamond_sword');
});
test('charged attacks wait for ordinary falling motion; shields respect server cooldown',()=>{
  assert.equal(combatDecision({self,target,now:1000,nextAttackAt:1500}).mode,'strafe');
  assert.equal(combatDecision({self,target,now:1000,canCriticalJump:true}).mode,'jump');
  assert.equal(combatDecision({self:{...self,onGround:false,velocity:{y:.2}},target,now:1000,criticalPending:true}).mode,'wait');
  assert.equal(combatDecision({self:{...self,onGround:false,velocity:{y:-.2}},target,now:1000,criticalPending:true}).critical,true);
  assert.equal(combatDecision({self:{...self,shield:true,shieldDisabledUntil:2000},target,now:1000,nextAttackAt:1500}).mode,'strafe');
  assert.equal(combatDecision({self:{...self,shield:true},target,now:1000,nextAttackAt:1500}).mode,'block');
  assert.equal(combatDecision({self:{...self,shield:true},target:{...target,equipment:{0:{name:'iron_axe'}}},now:1000,nextAttackAt:1500}).mode,'strafe');
  assert.equal(combatDecision({self:{...self,health:6},target,now:1000,canCriticalJump:true}).mode,'retreat');
});
test('guard equips the offhand once and restores the weapon selection',async()=>{
  const c=new OMConnect(),packets=[];
  const item=(name,slot)=>readSlot({itemCount:1,itemId:c.registry.itemsByName[name].id,components:[],removeComponents:[]},c.registry,slot);
  c.state={...c.state,...self,status:'ready'};c.inventory.slots[36]=item('iron_sword',36);c.inventory.slots[37]=item('shield',37);
  c.client={state:'play',end(){},write(name,p){packets.push({name,p});if(name==='block_dig'&&p.status===6){const slot=36+c.inventory.selected;c.inventory.slots[45]={...c.inventory.slots[slot],slot:45};c.inventory.slots[slot]=null;c.inventory.revision++;c.emit('inventory');}}};
  await c.execute({skill:'guard',args:{durationMs:50}});assert.equal(c.inventory.held().name,'iron_sword');assert.equal(c.inventory.slots[45].name,'shield');
  await c.execute({skill:'guard',args:{durationMs:50}});assert.equal(packets.filter(p=>p.name==='block_dig'&&p.p.status===6).length,1);
  c.shieldDisabledUntil=performance.now()+1000;await assert.rejects(c.execute({skill:'guard',args:{durationMs:50}}),/disabled the shield/i);await c.close();
});
