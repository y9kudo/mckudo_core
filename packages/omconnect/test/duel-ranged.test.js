import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatReactor} from '../../../src/combat.js';
import {OMConnect} from '../index.js';
import {runAction} from '../src/actions.js';
import {gazeAngles} from '../src/players.js';

const observation=()=>({dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20},inventory:{'minecraft:bow':1,'minecraft:arrow':64,'minecraft:diamond_sword':1},entities:[{id:'2',kind:'player',username:'Opponent',position:{x:10,y:64,z:0},visible:true}],combat:{attackers:[{entityId:'2',hits:2,lastHitAt:Date.now()}]}});
test('the core selects ranged combat only for a confirmed visible distant opponent with ammunition',()=>{
  const r=createCombatReactor({attackPlayers:true}),o=observation();
  let action=r.react(o).action;assert.equal(action.skill,'shoot');assert.equal(action.args.minDistance,6);assert.equal(action.args.allowPlayer,true);
  o.entities[0].position.x=3;assert.equal(r.react(o).action.skill,'combat');
  o.entities[0].position.x=10;delete o.inventory['minecraft:arrow'];assert.equal(r.react(o).action.skill,'combat');
  o.inventory['minecraft:arrow']=64;o.entities[0].visible=false;assert.equal(r.react(o).action.skill,'combat');
  o.entities[0].visible=true;o.entities[0].blocking=true;assert.equal(r.react(o).action.skill,'combat');o.entities[0].blocking=false;
  o.entities[0].visible=true;assert.equal(createCombatReactor({attackPlayers:true,ranged:false}).react(o).action.skill,'combat');
  o.combat.attackers=[];assert.equal(r.react(o).action,null);
});

function fixture(){
  const c=new OMConnect(),packets=[];
  Object.assign(c.state,{status:'ready',entityId:1,health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0},dimension:'minecraft:overworld'});
  const target={id:'2',kind:'player',name:'player',metadata:{},position:{x:10,y:1,z:.5},velocity:{x:0,y:0,z:0}};c.entities.set(2,target);
  for(const [slot,name,count]of [[36,'bow',1],[37,'arrow',64]])c.inventory.slots[slot]={name,type:c.registry.itemsByName[name].id,count,slot,raw:{components:[]}};
  c.world.blockAt=p=>p.y<1?{name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]}:{name:'air',boundingBox:'empty',shapes:[]};
  c.lookAt=p=>Object.assign(c.state,gazeAngles({...c.state.position,y:c.state.position.y+1.62},p));c.waitForLook=async()=>{};
  c.client={state:'play',write:(name,p)=>packets.push({name,p}),end(){}};
  return {c,target,packets};
}
test('a close opponent cancels bow selection before drawing instead of firing at melee range',async()=>{
  const {c,target,packets}=fixture();target.position.x=2;
  try{const result=await runAction(c,{skill:'shoot',args:{entityId:'2',allowPlayer:true,minDistance:6}},AbortSignal.timeout(2000));assert.equal(result.shotCancelled,true);assert.equal(result.reason,'melee-range');assert.equal(packets.length,0);}finally{await c.close();}
});
test('a charging bow is cancelled by switching slots when the opponent closes in, without releasing an arrow',async()=>{
  const {c,target,packets}=fixture();let move;
  const write=c.client.write;c.client.write=(name,p)=>{write(name,p);if(name==='use_item')move=setTimeout(()=>target.position.x=2,60);};
  try {
    const result=await runAction(c,{skill:'shoot',args:{entityId:'2',allowPlayer:true,minDistance:6}},AbortSignal.timeout(2500));
    assert.equal(result.shotCancelled,true);assert.equal(result.reason,'melee-range');
    assert.equal(packets.filter(p=>p.name==='use_item').length,1);
    assert.equal(packets.filter(p=>p.name==='block_dig'&&p.p.status===5).length,0);
    assert.ok(packets.filter(p=>p.name==='held_item_slot').length>=2);
  } finally {clearTimeout(move);await c.close();}
});

test('an opponent raising a facing shield during the draw cancels the arrow instead of wasting ammunition',async()=>{
  const {c,target,packets}=fixture();let raise;
  const write=c.client.write;c.client.write=(name,p)=>{write(name,p);if(name==='use_item')raise=setTimeout(()=>{target.yaw=90;target.equipment={1:{name:'shield'}};target.metadata.living_entity_flags=3;},60);};
  try{
    const result=await runAction(c,{skill:'shoot',args:{entityId:'2',allowPlayer:true,minDistance:6}},AbortSignal.timeout(2500));
    assert.equal(result.shotCancelled,true);assert.equal(result.reason,'shield-facing');
    assert.equal(packets.filter(p=>p.name==='block_dig'&&p.p.status===5).length,0);
    assert.equal(c.usingRangedItem,false);assert.equal(c.control.x,0);assert.equal(c.look.target,null);
  }finally{clearTimeout(raise);await c.close();}
});
