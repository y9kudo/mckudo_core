import test from 'node:test';
import assert from 'node:assert/strict';
import {OMConnect,OMProtection} from '../index.js';
import {planRoute} from '../src/navigation.js';
import {routeCanDig} from '../src/movement.js';
import {readSlot} from '../src/inventory.js';

const dimension='minecraft:overworld',key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const house={id:'home',dimension,min:{x:2,y:0,z:-1},max:{x:4,y:5,z:1}};
function fixture(options={}){
  const c=new OMConnect(options),blocks=new Map(),packets=[];
  const block=name=>({...c.registry.blocksByName[name],name,shapes:name==='air'?[]:[[0,0,0,1,1,1]],stateId:c.registry.blocksByName[name].defaultState});
  const at=p=>blocks.get(key(p))||block(p.y<1?'stone':'air');
  c.world={blockAt:at,stateAt:p=>at(p).stateId,dimension};
  Object.assign(c.state,{status:'ready',dimension,position:{x:.5,y:1,z:.5},health:20,food:20,onGround:true});
  c.client={state:'play',write:(name,p)=>packets.push({name,p})};
  c.waitForLook=async()=>{};
  return {c,blocks,packets,block};
}

test('regions are inclusive, dimension-specific, copied and validated',()=>{
  const policy=new OMProtection({regions:[house]});house.min.x=2;
  const check=(position,dim=dimension)=>policy.check({operation:'dig',position,dimension:dim});
  assert.equal(check({x:4.9,y:5,z:1}).allowed,false);
  assert.equal(check({x:4,y:5,z:1},'minecraft:the_nether').allowed,true);
  assert.equal(check({x:5,y:5,z:1}).allowed,true);
  const copy=policy.regions;copy[0].min.x=-100;assert.equal(check({x:-1,y:1,z:0}).allowed,true);
  assert.throws(()=>policy.add({...house,min:{x:NaN,y:1,z:0}}));
  assert.throws(()=>new OMProtection({regions:[house,house]}));
  assert.equal(policy.remove('home'),true);assert.equal(check({x:3,y:1,z:0}).allowed,true);
});

test('nearby building evidence protects log beams while ordinary trees and ores remain usable',()=>{
  const f=fixture();f.blocks.set('2,1,0',f.block('oak_log'));f.blocks.set('2,2,1',f.block('oak_planks'));f.blocks.set('10,1,0',f.block('birch_log'));f.blocks.set('10,2,1',f.block('birch_leaves'));
  const check=p=>f.c.protection.check({operation:'dig',dimension,position:p,block:f.c.world.blockAt(p),getBlock:f.c.world.blockAt});
  assert.equal(check({x:2,y:1,z:0}).allowed,false);
  assert.equal(check({x:10,y:1,z:0}).allowed,true);
  assert.equal(check({x:12,y:-10,z:0}).allowed,true);
  f.c.protection.remember(dimension,{x:2,y:2,z:1},f.block('oak_planks'));
  assert.equal(check({x:2,y:2,z:1}).allowed,true);
  f.c.protection.add(house);assert.equal(check({x:2,y:2,z:1}).allowed,false,'own blocks cannot bypass an explicit region');
});

test('native digging, placing and pillars reject protected coordinates before approaching or sending edits',async()=>{
  const f=fixture({protection:{regions:[{...house,min:{x:0,y:0,z:0}}]}});
  for(const action of [{skill:'dig',args:{x:2,y:1,z:0}},{skill:'place',args:{x:2,y:1,z:0,block:'dirt'}},{skill:'pillar',args:{count:1}}])await assert.rejects(f.c.execute(action),e=>e.code==='KUDO_PROTECTED');
  assert.equal(f.packets.filter(p=>p.name==='block_dig'||p.name==='block_place').length,0);
});

test('block approach rejects occluded standing ledges before issuing movement',async()=>{
  const f=fixture();
  // Every remote standing ledge is hidden behind an intact wall. A ray endpoint
  // at the target is ignored, but intervening wall geometry remains opaque.
  for(let x=1;x<=8;x++)for(let z=-5;z<=5;z++)for(let y=1;y<=4;y++)f.blocks.set(`${x},${y},${z}`,f.block('stone'));
  f.blocks.set('5,1,0',f.block('air'));f.blocks.set('5,2,0',f.block('air'));
  let navigation=0;f.c.waitFor=async()=>{navigation++;throw new Error('Unexpected movement wait.');};
  await assert.rejects(f.c.execute({skill:'dig',args:{x:6,y:1,z:0}}),/line of sight/);
  assert.equal(navigation,0);assert.equal(f.packets.some(p=>p.name==='block_dig'),false);
});

test('confirmed personal stations permit adjacent mining after restart while foreign anchors stay protected',()=>{
  const f=fixture(),station={x:2,y:1,z:0},target={x:1,y:1,z:0};
  f.blocks.set('2,1,0',f.block('furnace'));f.blocks.set('1,1,0',f.block('stone'));
  const options={operation:'dig',dimension,position:target,block:f.c.world.blockAt(target),getBlock:f.c.world.blockAt};
  assert.equal(f.c.protection.check(options).allowed,false);
  f.c.protection.remember(dimension,station,f.c.world.blockAt(station));
  assert.equal(f.c.protection.check(options).allowed,true);
  const restored=new OMProtection();restored.restoreMemory(f.c.protection.exportMemory());
  f.blocks.set('2,1,0',{...f.block('furnace'),stateId:f.block('furnace').stateId+1});
  assert.equal(restored.check(options).allowed,true,'a lit furnace retains station ownership');
  f.blocks.set('2,1,0',f.block('chest'));
  assert.equal(restored.check(options).allowed,false,'a replaced structural anchor is not owned');
  restored.add({id:'foreign-region',dimension,min:target,max:target});
  assert.equal(restored.check(options).allowed,false);
});

test('ownership restoration validates every record before replacing existing memory',()=>{
  const policy=new OMProtection();policy.remember(dimension,{x:1,y:1,z:1},{name:'furnace',stateId:4});
  const before=policy.exportMemory();
  for(const memory of [{schemaVersion:2,owned:[]},{schemaVersion:1,owned:[{key:'invalid',name:'furnace'}]},{schemaVersion:1,owned:[...before.owned,...before.owned]}]){
    assert.throws(()=>policy.restoreMemory(memory));assert.deepEqual(policy.exportMemory(),before);
  }
  const restored=new OMProtection();restored.restoreMemory(before);
  const copy=restored.exportMemory();copy.owned[0].name='chest';assert.deepEqual(restored.exportMemory(),before);
});

test('duplicate server updates retain ownership; furnace lighting changes do not erase it',()=>{
  const policy=new OMProtection(),p={x:2,y:1,z:0},unlit={name:'furnace',stateId:10,getProperties:()=>({facing:'north',lit:false})},lit={name:'furnace',stateId:11,getProperties:()=>({facing:'north',lit:true})};
  policy.remember(dimension,p,unlit);const revision=policy.revision;
  policy.observeBlockChange(dimension,p,unlit,{...unlit});assert.equal(policy.revision,revision);assert.equal(policy.exportMemory().owned.length,1);
  policy.observeBlockChange(dimension,p,unlit,lit);assert.equal(policy.exportMemory().owned[0].stateId,11);
  policy.observeBlockChange(dimension,p,lit,{name:'furnace',stateId:12,getProperties:()=>({facing:'east',lit:true})});assert.equal(policy.exportMemory().owned.length,0);
  policy.remember(dimension,p,unlit);policy.observeBlockChange(dimension,p,unlit,{name:'air',stateId:0});assert.equal(policy.exportMemory().owned.length,0);
});

test('harvesting mature food near a structure preserves explicit farm ownership regions',()=>{
  const f=fixture(),crop={x:1,y:1,z:0};
  f.blocks.set('1,1,0',{...f.block('carrots'),getProperties:()=>({age:7})});f.blocks.set('2,1,0',f.block('crafting_table'));
  const options={operation:'dig',dimension,position:crop,block:f.c.world.blockAt(crop),getBlock:f.c.world.blockAt};
  assert.equal(f.c.protection.check(options).allowed,true);
  f.c.protection.add({id:'owned-farm',dimension,min:crop,max:crop});assert.equal(f.c.protection.check(options).allowed,false);
});

test('side placement aims at the supporting face and sends the matching face cursor',async()=>{
  const f=fixture();f.c.state.position.y=101;f.blocks.set('0,100,0',f.block('stone'));
  f.c.inventory.slots[36]=readSlot({itemCount:2,itemId:f.c.registry.itemsByName.cobblestone.id,components:[],removeComponents:[]},f.c.registry,36);
  let looked;
  f.c.lookAt=p=>{looked=p;};
  f.c.client.write=(name,p)=>{f.packets.push({name,p});if(name==='block_place'){f.blocks.set('1,100,0',f.block('cobblestone'));f.c.emit('block');}};
  await f.c.execute({skill:'place',args:{x:1,y:100,z:0,block:'cobblestone'}});
  const packet=f.packets.find(p=>p.name==='block_place').p;
  assert.equal(packet.direction,5);assert.equal(packet.cursorX,1);assert.equal(packet.cursorY,.5);assert.equal(packet.cursorZ,.5);
  assert.deepEqual(looked,{x:1,y:100.5,z:.5});
});

test('placing on an interactive support crouches before the click and restores controls',async()=>{
  const f=fixture();f.c.state.entityId=1;f.blocks.set('1,0,0',f.block('furnace'));
  f.c.inventory.slots[36]=readSlot({itemCount:1,itemId:f.c.registry.itemsByName.crafting_table.id,components:[],removeComponents:[]},f.c.registry,36);
  f.c.lookAt=()=>{};
  f.c.client.write=(name,p)=>{
    f.packets.push({name,p});
    if(name==='block_place'){
      assert.equal(f.c.control.sneak,true);
      assert.ok(f.packets.some(p=>p.name==='entity_action'&&p.p.actionId==='start_sneaking'));
      f.blocks.set('1,1,0',f.block('crafting_table'));f.c.emit('block');
    }
  };
  await f.c.execute({skill:'place',args:{x:1,y:1,z:0,block:'crafting_table'}});
  assert.equal(f.c.control.sneak,false);
  assert.equal(f.c.containers.current,null);
});

test('a failed placement closes its unexpected menu without leaving crouch enabled',async()=>{
  const f=fixture();f.c.state.entityId=1;
  f.c.inventory.slots[36]=readSlot({itemCount:1,itemId:f.c.registry.itemsByName.cobblestone.id,components:[],removeComponents:[]},f.c.registry,36);
  f.c.lookAt=()=>{};
  f.c.client.write=(name,p)=>{
    f.packets.push({name,p});
    if(name==='block_place')f.c.containers.open({windowId:7,inventoryType:14});
  };
  await assert.rejects(f.c.execute({skill:'place',args:{x:1,y:1,z:0,block:'cobblestone'}},{signal:AbortSignal.timeout(80)}));
  assert.equal(f.c.containers.current,null);
  assert.equal(f.c.control.sneak,false);
  assert.ok(f.packets.some(p=>p.name==='close_window'&&p.p.windowId===7));
});

test('route excavation detours around a stone house and permits walking on protected floors',()=>{
  const f=fixture({protection:{regions:[house]}});
  f.c.inventory.slots[36]=readSlot({itemCount:1,itemId:f.c.registry.itemsByName.diamond_pickaxe.id,components:[],removeComponents:[]},f.c.registry,36);
  for(let x=2;x<=4;x++)for(let z=-1;z<=1;z++)for(let y=1;y<=4;y++)f.blocks.set(`${x},${y},${z}`,f.block('stone'));
  const route=planRoute({start:{x:0,y:1,z:0},goal:{x:6,y:1,z:0},getBlock:f.c.world.blockAt,canDig:routeCanDig(f.c),maxDrop:1,maxNodes:2500});
  assert.equal(route.status,'planned');assert.equal(route.steps.some(s=>s.kind==='dig'),false);assert.ok(route.steps.some(s=>Math.abs(s.position.z)>=2));
  const floorRoute=planRoute({start:{x:0,y:1,z:4},goal:{x:6,y:1,z:4},getBlock:f.c.world.blockAt});assert.equal(floorRoute.status,'planned');
});

test('bridge planning honors placement restrictions before reserving materials',()=>{
  const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const getBlock=p=>p.z!==0||p.y<0?null:p.y===0&&p.x!==1?stone:air;
  const options={start:{x:0,y:1,z:0},goal:{x:2,y:1,z:0},getBlock,bridgeBudget:2,maxDrop:1,maxNodes:100};
  assert.equal(planRoute(options).status,'planned');assert.equal(planRoute({...options,canPlace:()=>false}).status,'blocked');
});

test('protection added during look or mining cancels the edit before the finishing packet',async()=>{
  for(const when of ['look','mining']){
    const f=fixture();f.blocks.set('2,1,0',f.block('dirt'));
    const lock=()=>f.c.protection.add(house);
    if(when==='look')f.c.waitForLook=async()=>lock();
    else f.c.client.write=(name,p)=>{f.packets.push({name,p});if(name==='block_dig'&&p.status===0)lock();};
    await assert.rejects(f.c.execute({skill:'dig',args:{x:2,y:1,z:0,block:'dirt'}}),e=>e.code==='KUDO_PROTECTED');
    assert.equal(f.packets.some(p=>p.name==='block_dig'&&p.p.status===2),false);
    assert.equal(f.packets.some(p=>p.name==='block_dig'&&p.p.status===0),when==='mining');
    if(when==='mining')assert.ok(f.packets.some(p=>p.name==='block_dig'&&p.p.status===1));
  }
});
