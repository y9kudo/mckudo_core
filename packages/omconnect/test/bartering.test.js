import test from 'node:test';
import assert from 'node:assert/strict';
import {barter,wearsGold,piglinAngerRisk} from '../src/bartering.js';
const signal=()=>new AbortController().signal;
function fixture(){
  const target={id:'2',name:'piglin',position:{x:2,y:64,z:0},metadata:{baby:false}},packets=[];let gold=2;
  const c={state:{dimension:'minecraft:the_nether',status:'ready',health:20,position:{x:0,y:64,z:0}},inventory:{count:n=>n==='gold_ingot'?gold:0,equipment:()=>({feet:{name:'golden_boots'}}),slots:Array(46).fill(null)},entities:new Map([[2,target]]),attackers:new Map(),world:{blockAt:()=>({name:'air',shapes:[]})},stopMovement(){},lookAt(){},waitForLook:async()=>{},emit(){},
    write(n,p){packets.push({n,p});if(n==='use_entity'){gold--;c.entities.set(3,{name:'item',item:{name:'gravel',count:8},position:{x:2,y:64,z:0}});}},waitFor:async fn=>{assert.equal(fn(),true);}};
  const runtime={select:async()=>{},run:async()=>{throw new Error('No movement expected');}};return {c,target,packets,runtime};
}
test('native barter sends an interaction, confirms ingot loss, never fabricates pearls or reward ownership',async()=>{
  const {c,packets,runtime}=fixture();const r=await barter(c,{entityId:'2'},signal(),runtime);
  assert.equal(r.consumed,1);assert.equal(r.serverConfirmed,true);assert.equal(r.rewardConfirmed,false);assert.equal(r.dropsObserved[0].item,'minecraft:gravel');assert.equal(c.inventory.count('ender_pearl'),0);
  assert.deepEqual(packets[0],{n:'use_entity',p:{target:2,mouse:0,hand:0,sneaking:false}});
});
test('barter refuses babies, brutes, unknown age, no gold armor, attackers and full inventory before sending',async()=>{
  for(const mutate of [x=>x.target.metadata.baby=true,x=>x.target.name='piglin_brute',x=>delete x.target.metadata.baby,x=>x.c.inventory.equipment=()=>({}),x=>x.c.attackers.set('2',{entityId:'2',lastHitAt:Date.now()}),x=>x.c.inventory.slots.fill({})]){
    const f=fixture();mutate(f);await assert.rejects(barter(f.c,{entityId:'2'},signal(),f.runtime));assert.equal(f.packets.length,0);
  }
});
test('barter cannot succeed on a client click without authoritative ingot consumption',async()=>{
  const {c,runtime}=fixture();c.write=()=>{};c.waitFor=async fn=>{assert.equal(fn(),false);throw new Error('No server confirmation');};
  await assert.rejects(barter(c,{entityId:'2'},signal(),runtime),/confirmation/);
});
test('gold armor and anger rules distinguish equipment slots, mobs and dimensions',()=>{
  assert.equal(wearsGold({feet:{item:'minecraft:golden_boots'}}),true);assert.equal(wearsGold({hand:{name:'golden_sword'}}),false);
  const e=[{name:'piglin',position:{x:5,y:64,z:0}}],p={x:0,y:64,z:0};assert.equal(piglinAngerRisk('minecraft:the_nether',p,e),true);assert.equal(piglinAngerRisk('minecraft:overworld',p,e),false);
});
