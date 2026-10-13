import test from 'node:test';
import assert from 'node:assert/strict';
import {KudoConnect,planElytraFlight,elytraControl,stepPhysics,findSigns} from '../index.js';
import {readSlot} from '../src/inventory.js';
import {rotateToward} from '../src/movement.js';
const registry=new KudoConnect().registry,empty=()=>({itemCount:0});
const raw=(name,count=1,components=[])=>({itemCount:count,itemId:registry.itemsByName[name].id,components,removeComponents:[]});
const air={name:'air',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},ground=p=>p.y<1?stone:air;

function storageFixture({source=[raw('apple',10)],player=[],ack=true,cancel}={}){
  const c=new KudoConnect();c.state={...c.state,status:'ready',health:20,onGround:true,position:{x:.5,y:1,z:.5},dimension:'minecraft:overworld'};
  const slots=Array.from({length:63},empty);source.forEach((s,i)=>slots[i]=s);player.forEach((s,i)=>slots[27+i]=s);let cursor=empty(),rev=0;
  c.world.blockAt=p=>Math.floor(p.x)===2&&Math.floor(p.y)===1&&Math.floor(p.z)===0?{name:'chest',shapes:[],getProperties:()=>({type:'single'})}:ground(p);
  c.lookAt=()=>{};c.waitForLook=async()=>{};
  const sync=()=>{c.containers.updateWindow({windowId:1,stateId:++rev,items:structuredClone(slots),carriedItem:structuredClone(cursor)});c.emit('container');};
  c.client={state:'play',end(){},write(name,p){
    if(name==='block_place'){c.containers.open({windowId:1,inventoryType:2});sync();}
    if(name==='window_click'&&p.windowId===1&&ack){
      const s=slots[p.slot];
      if(p.mode===1){
        let remaining=s.itemCount;const from=p.slot<27?27:0,to=p.slot<27?63:27;
        for(const merge of [true,false])for(let i=from;i<to&&remaining;i++){
          const t=slots[i],same=t.itemCount&&t.itemId===s.itemId&&JSON.stringify(t.components)===JSON.stringify(s.components);
          if(merge?!same:t.itemCount)continue;
          const amount=Math.min(remaining,(registry.items[s.itemId]?.stackSize||64)-(t.itemCount||0));if(!amount)continue;
          slots[i]={...structuredClone(s),itemCount:(t.itemCount||0)+amount};remaining-=amount;
        }
        slots[p.slot]=remaining?{...s,itemCount:remaining}:empty();
      }else if(p.mode===0){
        if(!cursor.itemCount){cursor=structuredClone(s);slots[p.slot]=empty();}
        else if(p.mouseButton===1){slots[p.slot]={...structuredClone(cursor),itemCount:(s.itemCount||0)+1};cursor.itemCount--;if(!cursor.itemCount)cursor=empty();cancel?.();}
        else{slots[p.slot]={...structuredClone(cursor),itemCount:(s.itemCount||0)+cursor.itemCount};cursor=empty();}
      }
      sync();
    }
  }};
  return {c,slots,cursor:()=>cursor};
}
test('takeStorage withdraws an exact partial quantity, returns remainder, and deposit confirms both sides',async()=>{
  const {c,slots,cursor}=storageFixture();
  const r=await c.execute({skill:'takeStorage',args:{x:2,y:1,z:0,amounts:{apple:3}}});
  assert.equal(r.transferred[0].count,3);assert.equal(slots[0].itemCount,7);assert.equal(c.inventory.count('apple'),3);assert.equal(cursor().itemCount,0);assert.equal(c.containers.current,null);
  const back=await c.execute({skill:'depositStorage',args:{x:2,y:1,z:0,amounts:{apple:2}}});
  assert.equal(back.transferred[0].count,2);assert.equal(c.inventory.count('apple'),1);assert.equal(slots[0].itemCount,9);await c.close();
});
test('partial destination capacity transfers only available space and preserves the carried remainder',async()=>{
  const player=Array.from({length:36},()=>raw('stone',64));player[0]=raw('apple',63);
  const {c,slots,cursor}=storageFixture({player});
  const r=await c.execute({skill:'takeStorage',args:{x:2,y:1,z:0,items:['apple']}});
  assert.equal(r.transferred[0].count,1);assert.equal(r.reason,'destination-full');assert.equal(slots[0].itemCount,9);assert.equal(cursor().itemCount,0);await c.close();
});
test('cancelled exact transfer returns the cursor before closing the storage',async()=>{
  const controller=new AbortController();const {c,slots,cursor}=storageFixture({cancel:()=>controller.abort(new Error('cancelled'))});
  await assert.rejects(c.execute({skill:'takeStorage',args:{x:2,y:1,z:0,amounts:{apple:3}}},{signal:controller.signal}),/cancelled/);
  assert.equal(cursor().itemCount,0);assert.equal(slots.reduce((n,s)=>n+(s.itemId===registry.itemsByName.apple.id?s.itemCount:0),0),10);assert.equal(c.containers.current,null);await c.close();
});
test('missing server acknowledgement cannot fabricate a storage transfer',async()=>{
  const {c}=storageFixture({ack:false});await assert.rejects(c.execute({skill:'takeStorage',args:{x:2,y:1,z:0,items:['apple']}},{signal:AbortSignal.timeout(30)}));
  assert.equal(c.inventory.count('apple'),0);assert.equal(c.containers.current,null);await c.close();
});
test('flight planning rejects unknown corridors and unsafe landings before takeoff',()=>{
  const options={start:{x:0,y:1,z:0},goal:{x:0,y:1,z:90},getBlock:ground};
  assert.equal(planElytraFlight(options).status,'planned');
  assert.equal(planElytraFlight({...options,getBlock:p=>p.z===40?null:ground(p)}).reason,'unloaded');
  assert.equal(planElytraFlight({...options,getBlock:p=>Math.floor(p.z)===90&&p.y<1?{name:'lava',shapes:[]}:ground(p)}).reason,'landing-patch');
});
test('flight controller uses glide physics, rocket boost and a flare to reach the landing patch',()=>{
  let s={position:{x:0,y:2,z:0},velocity:{x:0,y:-.1,z:0},yaw:0,pitch:-45,onGround:false,gliding:true,elytraEquipped:true,food:20};
  let maxY=2,ticks=0;
  for(;ticks<1000&&!s.onGround;ticks++){
    s.rocketBoost=ticks<50;const control=elytraControl({...s,landing:{x:0,y:1,z:95},altitude:17,boosting:s.rocketBoost});Object.assign(s,rotateToward(s,control));s=stepPhysics(s,{},ground);maxY=Math.max(maxY,s.position.y);
  }
  assert.ok(maxY>10);assert.ok(ticks<1000);assert.equal(s.onGround,true);assert.equal(s.gliding,false);assert.ok(Math.hypot(s.position.x,s.position.z-95)<8);
});
test('ordinary ground physics cannot enter elytra mode without a server flight flag',()=>{
  const s=stepPhysics({position:{x:0,y:10,z:0},velocity:{x:0,y:0,z:0},yaw:0,pitch:-45,elytraEquipped:true,rocketBoost:true,onGround:false},{},ground);
  assert.equal(s.position.y,10);assert.ok(s.velocity.y<0);assert.equal(s.gliding,undefined);
});
test('native flight executor yields to physics ticks and confirms takeoff, rocket and landing',async()=>{
  const c=new KudoConnect();c.state={...c.state,status:'ready',health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5},elytraEquipped:true};
  c.world.blockAt=ground;c.inventory.slots[6]=readSlot(raw('elytra'),registry,6);c.inventory.slots[36]=readSlot(raw('firework_rocket',8),registry,36);
  c.lookAt=p=>{const dx=p.x-c.state.position.x,dz=p.z-c.state.position.z;c.state.yaw=Math.atan2(-dx,dz)*180/Math.PI;c.state.pitch=-Math.atan2(p.y-c.state.position.y-1.62,Math.hypot(dx,dz))*180/Math.PI;};c.waitForLook=async()=>{};
  let rocketTicks=0;
  c.client={state:'play',end(){},write(name,p){
    if(name==='entity_action'&&p.actionId==='start_fall_flying'){c.state.gliding=true;c.selfMetadata.shared_flags=128;c.flightEvidence.takeoffs++;c.emit('selfMetadata');}
    if(name==='use_item'){rocketTicks=50;c.state.rocketBoost=true;c.flightEvidence.rockets++;c.inventory.slots[36].count--;c.inventory.slots[36].raw.itemCount--;c.emit('inventory');}
  }};
  const timer=setInterval(()=>{c.tickTiming.mark(performance.now());c.state.rocketBoost=rocketTicks-->0;c.state=stepPhysics(c.state,c.control,ground);if(c.state.onGround){c.selfMetadata.shared_flags=0;c.emit('selfMetadata');}c.emit('physics');},3);
  try{
    const result=await c.execute({skill:'fly',args:{x:0,y:1,z:95,timeoutMs:3000,maxRockets:1}});
    assert.equal(result.takeoffs,1);assert.equal(result.rocketsUsed,1);assert.ok(c.tickTiming.ticks>60);assert.equal(result.serverConfirmed,true);
  }finally{clearInterval(timer);await c.close();}
});
test('sign text is read as data and stale block entities disappear on unload/reset',()=>{
  const c=new KudoConnect(),w=c.world;w.columnAt=()=>({});w.blockAt=()=>({name:'oak_wall_sign'});
  const data={type:'compound',value:{front_text:{type:'compound',value:{messages:{type:'list',value:{type:'string',value:['"Random"','{"text":"Материалы","extra":[{"text":" 07"}]}','""','""']}}}},is_waxed:{type:'byte',value:0}}};
  w.setBlockEntity({x:2,y:72,z:0},data);assert.equal(findSigns(w,{text:'Random',position:{x:0,y:72,z:0}})[0].front[1],'Материалы 07');
  w.unload(0,0);assert.equal(w.blockEntities.size,0);w.setBlockEntity({x:2,y:72,z:0},data);w.reset('minecraft:the_end');assert.equal(w.blockEntities.size,0);
});
test('labelStorage uses a top sign when the sides are blocked and waits for server NBT',async()=>{
  const c=new KudoConnect();c.state={...c.state,status:'ready',health:20,onGround:true,position:{x:.5,y:1,z:.5},dimension:'minecraft:overworld'};
  const target={x:2,y:1,z:0},top={x:2,y:2,z:0};let placed=false;
  c.world.columnAt=()=>({});c.world.blockAt=p=>Math.floor(p.x)===2&&Math.floor(p.y)===1&&Math.floor(p.z)===0?{name:'chest',shapes:[],getProperties:()=>({type:'single',facing:'east'})}:Math.floor(p.x)===2&&Math.floor(p.y)===2&&Math.floor(p.z)===0&&placed?{name:'oak_sign',shapes:[]}:Math.floor(p.y)<2?stone:air;
  c.lookAt=()=>{};c.waitForLook=async()=>{};c.inventory.slots[36]=readSlot(raw('oak_sign',2),registry,36);
  c.client={state:'play',end(){},write(name,p){
    if(name==='block_place'){assert.deepEqual(p.location,target);assert.equal(p.direction,1);placed=true;c.signEditor={location:top,isFrontText:true};c.emit('signEditor');}
    if(name==='update_sign'){
      assert.deepEqual(p.location,top);
      const nbt={type:'compound',value:{front_text:{type:'compound',value:{messages:{type:'list',value:{type:'string',value:[p.text1,p.text2,p.text3,p.text4].map(x=>JSON.stringify(x))}}}},is_waxed:{type:'byte',value:0}}};
      c.world.setBlockEntity(top,nbt);c.emit('blockEntity',top);
    }
  }};
  const r=await c.execute({skill:'labelStorage',args:{...target,lines:['Еда','MCKudo','0.7']}});
  assert.equal(r.serverConfirmed,true);assert.deepEqual(r.position,top);assert.equal(c.signAt(top).front[0],'Еда');await c.close();
});
