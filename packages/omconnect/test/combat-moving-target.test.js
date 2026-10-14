import test from 'node:test';
import assert from 'node:assert/strict';
import {OMConnect} from '../src/client.js';
import {runAction} from '../src/actions.js';
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const flat=p=>p.y<64?stone:air;
function fixture(){
  const c=new OMConnect(),target={id:'2',name:'zombie',kind:'entity',position:{x:2,y:64,z:0},metadata:{}};
  Object.assign(c.state,{status:'ready',position:{x:0,y:64,z:0},velocity:{x:0,y:0,z:0},health:20,food:20,onGround:true,dimension:'minecraft:overworld'});
  c.world.blockAt=flat;c.entities.set(2,target);const item=c.registry.itemsByName.stone_sword;
  c.inventory.slots[36]={name:'stone_sword',item:'minecraft:stone_sword',type:item.id,count:1,slot:36,raw:{components:[]}};
  c.lookAt=()=>{};c.write=()=>{};return {c,target};
}
test('moving out of reach during aiming replans inside a combat frame rather than dropping defense',async()=>{
  const {c,target}=fixture();let turns=0,attacks=0;
  c.write=n=>{if(n==='use_entity')attacks++;};
  c.waitForLook=async()=>{if(++turns===1){target.position.x=4;setTimeout(()=>target.position.x=2,15);}};
  const result=await runAction(c,{skill:'combat',args:{entityId:'2',durationMs:150,critical:false}},AbortSignal.timeout(2000));
  assert.equal(result.ok,true);assert.equal(attacks,1);assert.ok(turns>=2);
});
test('a close zombie triggers a safe immediate retreat before expensive route planning',async()=>{
  const {c,target}=fixture();c.state.health=5;let moving=false;
  const timer=setTimeout(()=>{moving=Math.hypot(c.control.x,c.control.z)>.1;},30);
  try{const result=await runAction(c,{skill:'evade',args:{from:target.position,entityId:target.id}},AbortSignal.timeout(1000));assert.equal(result.emergencyStep,true);assert.equal(moving,true);}finally{clearTimeout(timer);}
});
test('Nether water actions fail before use-item or block-place packets',async()=>{
  const {c}=fixture();c.state.dimension='minecraft:the_nether';c.write=()=>assert.fail('Water must not be placed in the Nether');
  for(const skill of ['waterGuard','waterClutch'])await assert.rejects(runAction(c,{skill,args:{}},AbortSignal.timeout(1000)),/evaporates/i);
});
