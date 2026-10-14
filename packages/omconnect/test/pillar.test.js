import test from 'node:test';
import assert from 'node:assert/strict';
import {OMConnect} from '../src/client.js';
import {stepPhysics} from '../src/physics.js';

const key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
function fixture({confirm=true,ceiling=false,crystal=false}={}) {
  const c=new OMConnect(),blocks=new Map(),samples=[],packets=[];
  const air={name:'air',shapes:[],boundingBox:'empty'},stone={...c.registry.blocksByName.dirt,name:'stone',shapes:[[0,0,0,1,1,1]],boundingBox:'block'};
  c.world.blockAt=p=>blocks.get(key(p))||(Math.floor(p.y)<1||ceiling&&p.y>=3?stone:air);
  Object.assign(c.state,{position:{x:.7,y:1,z:.4},velocity:{x:0,y:-.0784,z:0},health:20,food:20,onGround:true,status:'ready',dimension:'minecraft:the_end'});
  c.inventory.slots[36]={name:'dirt',item:'minecraft:dirt',count:4,type:c.registry.itemsByName.dirt.id,slot:36,raw:{}};
  c.client={state:'play',write:(name,p)=>{
    packets.push({name,p});
    if(name==='block_place'){
      assert.ok(c.state.position.y>=p.location.y+2.01,'feet must clear placed block');
      if(confirm){blocks.set(key({...p.location,y:p.location.y+1}),{...stone,name:'dirt'});c.inventory.slots[36].count--;c.inventory.revision++;c.emit('inventory');}
    }
    if(name==='block_dig'&&p.status===2&&confirm){blocks.set(key(p.location),air);c.emit('block');}
  }};
  if(crystal)c.entities.set(2,{id:'2',name:'end_crystal',position:{x:1,y:2,z:0}});
  c.timer=setInterval(()=>{c.tickLook();c.state=stepPhysics(c.state,c.control,c.world.blockAt);samples.push({...c.state.position});c.emit('physics');},5);
  return {c,packets,samples,stop:()=>clearInterval(c.timer)};
}
test('pillar jump-places three blocks with inventory and landing confirmation',async()=>{
  const f=fixture();try{
    const result=await f.c.execute({skill:'pillar',args:{count:3}},{signal:AbortSignal.timeout(7000)});
    assert.equal(result.serverConfirmed,true);assert.equal(result.placed.length,3);assert.equal(f.c.state.position.y,4);assert.equal(f.c.inventory.count('dirt'),1);
    assert.ok(f.samples.every((p,i)=>!i || Math.abs(p.y-f.samples[i-1].y)<=.421));
    assert.equal(f.packets.filter(p=>p.name==='block_place').length,3);assert.equal(f.c.control.jump,false);
  }finally{f.stop();}
});
test('pillar refuses low ceilings and nearby crystals before consuming blocks',async()=>{
  for(const options of [{ceiling:true},{crystal:true}]){const f=fixture(options);try{
    await assert.rejects(f.c.execute({skill:'pillar',args:{count:1}}),/free|crystal/);
    assert.equal(f.packets.filter(p=>p.name==='block_place').length,0);assert.equal(f.c.control.jump,false);
  }finally{f.stop();}}
});
test('unconfirmed placement is not counted; cancellation releases jump input',async()=>{
  const f=fixture({confirm:false});try{
    await assert.rejects(f.c.execute({skill:'pillar',args:{count:2}},{signal:AbortSignal.timeout(400)}));
    assert.equal(f.c.inventory.count('dirt'),4);assert.equal(f.c.control.jump,false);
    assert.equal(f.packets.filter(p=>p.name==='block_place').length,1);
  }finally{f.stop();}
});
test('descent removes only verified own blocks, one landing at a time',async()=>{
  const f=fixture();try{
    await assert.rejects(f.c.execute({skill:'descendPillar',args:{count:1}}),/own/);
    await f.c.execute({skill:'pillar',args:{count:2}});
    const result=await f.c.execute({skill:'descendPillar',args:{count:2}});
    assert.equal(result.removed.length,2);assert.equal(f.c.state.position.y,1);assert.equal(f.c.pillarBlocks.size,0);
  }finally{f.stop();}
});
