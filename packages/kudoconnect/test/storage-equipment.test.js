import test from 'node:test';
import assert from 'node:assert/strict';
import { KudoConnect, KudoContainers, KudoInventory, chooseMiningTool, storageIdentity } from '../index.js';
import { readSlot } from '../src/inventory.js';
import { chooseWeapon } from '../src/combat.js';
const client = new KudoConnect(), registry = client.registry;
const raw = (name, count = 1, damage = 0) => ({ itemCount: count, itemId: registry.itemsByName[name].id, components: damage ? [{ type: 'damage', data: damage }] : [], removeComponents: [] });
const item = (name, slot, damage = 0) => readSlot(raw(name, 1, damage), registry, slot);
const empty = () => ({ itemCount: 0 });

test('container slots mirror inventory; stale revisions and foreign windows cannot overwrite it', () => {
  const inv = new KudoInventory(registry), storage = new KudoContainers(inv,registry);
  storage.open({ windowId: 4, inventoryType: 2 });
  const items = Array.from({ length: 63 },empty); items[0] = raw('birch_log', 3); items[27] = raw('stone_pickaxe');
  assert.equal(storage.updateWindow({ windowId: 4, stateId: 5, items }), true);
  assert.equal(inv.slots[9].name, 'stone_pickaxe'); assert.equal(storage.contents()[0].count,3);
  assert.equal(storage.updateSlot({ windowId:4, stateId:4, slot:27, item:empty() }),false);
  assert.equal(storage.updateSlot({ windowId:7, stateId:6, slot:27, item:empty() }),false);
  assert.equal(inv.slots[9].name,'stone_pickaxe');
  storage.updateSlot({ windowId:4, stateId:6, slot:62, item:raw('apple',4) }); assert.equal(inv.slots[44].count,4);
  storage.current.stateId = 32767; assert.equal(storage.acceptState(0),true);
});

test('capacity distinguishes full inventory, matching partial stacks and different components', () => {
  const inv = new KudoInventory(registry), storage = new KudoContainers(inv,registry), source = item('birch_log',0);
  for (let i = 9; i <= 44; i++) inv.slots[i] = readSlot(raw('stone',64),registry,i);
  assert.equal(storage.capacity(source),0);
  inv.slots[9] = readSlot(raw('birch_log',63),registry,9); assert.equal(storage.capacity(source),1);
  inv.slots[9].raw.removeComponents = ['custom_name']; assert.equal(storage.capacity(source),0);
});

function chestClient(ack = true) {
  const c = new KudoConnect(), packets = [];
  c.state = { ...c.state, status:'ready', health:20, onGround:true, dimension:'minecraft:overworld', position:{x:.5,y:1,z:.5} };
  c.world.blockAt = p => Math.floor(p.x) === 2 && Math.floor(p.y) === 1 ? { name:'chest', shapes:[[0,0,0,1,1,1]] } : {name:'air',shapes:[]};
  c.client = { state:'play', end(){}, write(name,p) {
    packets.push({name,p});
    if (name === 'block_place') {
      c.containers.open({windowId:2,inventoryType:2}); const items = Array.from({length:63},empty); items[0] = raw('birch_log',4);
      c.containers.updateWindow({windowId:2,stateId:1,items}); c.emit('container');
    }
    if (name === 'window_click' && ack) {
      c.containers.updateSlot({windowId:2,stateId:2,slot:0,item:empty()});
      c.containers.updateSlot({windowId:2,stateId:2,slot:54,item:raw('birch_log',4)}); c.emit('container');
    }
  }};
  return {c,packets};
}
test('lootChest waits for both source depletion and own inventory; closes its window', async () => {
  const {c,packets} = chestClient();
  const result = await c.execute({skill:'lootChest',args:{x:2,y:1,z:0}});
  assert.deepEqual(result.transferred,[{item:'minecraft:birch_log',count:4}]); assert.equal(c.inventory.count('birch_log'),4);
  assert.equal(packets.find(p => p.name === 'window_click').p.mode,1); assert.equal(packets.at(-1).name,'close_window');
  assert.equal(c.containers.current,null); assert.equal(c.containerRequest,false); await c.close();
});
test('unacknowledged withdrawal does not create items and cancellation closes the chest', async () => {
  const {c,packets} = chestClient(false), abort=new AbortController();
  const action=c.execute({skill:'lootChest',args:{x:2,y:1,z:0}},{signal:abort.signal});const failed=assert.rejects(action);
  while(!packets.some(p=>p.name==='window_click'))await new Promise(r=>setTimeout(r,10));abort.abort();await failed;
  assert.equal(c.inventory.count('birch_log'),0); assert.equal(c.containers.current,null); assert.equal(c.containerRequest,false);
  assert.ok(packets.some(p => p.name === 'close_window')); await c.close();
});
test('combat priority interrupts chest pickup before another inventory click', async () => {
  const {c,packets} = chestClient(false);
  const looting = c.execute({skill:'lootChest',args:{x:2,y:1,z:0}},{priority:10}); const rejection = assert.rejects(looting,/приоритет/);
  while(!packets.some(p=>p.name==='window_click'))await new Promise(r=>setTimeout(r,10));
  await c.execute({skill:'look',args:{x:3,y:2,z:0}},{priority:990}); await rejection;
  assert.equal(c.containers.current,null); assert.equal(packets.filter(p=>p.name==='window_click').length,1); await c.close();
});
test('tool choice uses block mechanics, harvest level and the exact surviving tool slot', () => {
  const block = name => client.world.Block.fromStateId(registry.blocksByName[name].defaultState,0);
  const tools = [item('iron_pickaxe',36),item('stone_axe',37),item('stone_axe',38,registry.itemsByName.stone_axe.maxDurability)];
  assert.equal(chooseMiningTool(registry,block('birch_log'),tools).item.slot,37);
  assert.equal(chooseMiningTool(registry,block('stone'),tools).item.slot,36);
  assert.equal(chooseMiningTool(registry,block('diamond_ore'),[item('wooden_pickaxe',36)]),null);
  assert.equal(chooseMiningTool(registry,block('oak_log'),[]).item,null);
  assert.equal(chooseWeapon([item('diamond_sword',36),item('stone_axe',37)]).name,'diamond_sword');
  assert.equal(chooseWeapon([item('diamond_sword',36),item('stone_axe',37)],{shieldedTarget:true}).name,'stone_axe');
});
test('combat selects the healthy duplicate weapon by slot rather than the first matching name', async () => {
  const {c,packets} = chestClient();
  c.inventory.slots[36] = item('stone_axe',36,registry.itemsByName.stone_axe.maxDurability);
  c.inventory.slots[37] = item('stone_axe',37);
  c.entities.set(2,{id:'2',name:'zombie',kind:'entity',position:{x:2,y:1,z:0},metadata:{}});
  await c.execute({skill:'combat',args:{entityId:'2',durationMs:50}});
  assert.equal(c.inventory.selected,1); assert.equal(packets.find(p=>p.name==='held_item_slot').p.slotId,1); await c.close();
});
test('shulker and double chest windows use their real slot layouts', () => {
  for(const [type,size] of [[20,27],[5,54]]) {
    const inv = new KudoInventory(registry), storage = new KudoContainers(inv,registry);
    storage.open({windowId:1,inventoryType:type}); const items=Array.from({length:size+36},empty); items[size-1]=raw('apple',3);items[size+35]=raw('iron_axe');
    assert.equal(storage.updateWindow({windowId:1,stateId:0,items}),true);assert.equal(storage.contents()[0].count,3);assert.equal(inv.slots[44].name,'iron_axe');
  }
});
test('storage discovery groups complementary double chest halves and supports every shulker color', async () => {
  const c = new KudoConnect(); c.state.position={x:0,y:64,z:0};
  assert.equal(c.world.resolveSelectors(['#containers']).filter(n=>n.endsWith('shulker_box')).length,17);
  const left={name:'chest',getProperties:()=>({type:'left',facing:'north'})},right={name:'chest',getProperties:()=>({type:'right',facing:'north'})};
  c.world.blockAt=p=>p.x===2?left:p.x===3?right:p.x===5?{name:'red_shulker_box'}:null;
  const a=storageIdentity(c.world,{x:2,y:64,z:0}),b=storageIdentity(c.world,{x:3,y:64,z:0});assert.equal(a.key,b.key);assert.equal(a.kind,'double_chest');
  c.world.findBlocks=async()=>({blocks:[{name:'minecraft:chest',position:{x:2,y:64,z:0}},{name:'minecraft:chest',position:{x:3,y:64,z:0}},{name:'minecraft:red_shulker_box',position:{x:5,y:64,z:0}}],visited:20,revision:1,truncated:false});
  const result=await c.findStorages();assert.equal(result.storages.length,2);assert.equal(result.storages[1].kind,'shulker_box');
  assert.equal(storageIdentity(c.world,{x:9,y:64,z:0}),null);
});
test('drop requests authoritative resync when vanilla omits the expected slot update', async () => {
  const c = new KudoConnect();c.state={...c.state,status:'ready',health:20,position:{x:0,y:1,z:0}};
  c.inventory.slots[36]=readSlot(raw('apple',4),registry,36);let serverCount=4;
  c.client={state:'play',end(){},write(name,p){
    if(name==='block_dig'&&p.status===4)serverCount--;
    if(name==='window_click'&&p.slot===-999){assert.equal(p.stateId,-1);assert.equal(p.cursorItem.itemCount,0);const items=Array.from({length:46},empty);items[36]=raw('apple',serverCount);c.inventory.updateWindow({windowId:0,stateId:2,items});c.emit('inventory');}
  }};
  const result=await c.execute({skill:'drop',args:{item:'apple',count:1}});assert.equal(result.lost,1);assert.equal(c.inventory.count('apple'),3);await c.close();
});
test('direct player inventory updates map hotbar and armor without replacing window state id',()=>{
  const inv=new KudoInventory(registry);inv.stateId=12;
  inv.updateSlot({windowId:-2,stateId:0,slot:0,item:raw('apple')});assert.equal(inv.slots[36].name,'apple');
  inv.updateSlot({windowId:-2,stateId:0,slot:39,item:raw('iron_helmet')});assert.equal(inv.slots[5].name,'iron_helmet');assert.equal(inv.stateId,12);
});
