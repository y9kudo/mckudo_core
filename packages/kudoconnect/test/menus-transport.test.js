import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {KudoConnect,KudoInventory,KudoContainers,observeMenu,findMenuSlot,menuText} from '../index.js';
import {clickMenu} from '../src/menus.js';
import {mountVehicle,dismountVehicle,synchronizeVehicle} from '../src/transport.js';
const registry=new KudoConnect().registry;
const raw=name=>({itemCount:1,itemId:registry.itemsByName[name].id,components:[],removeComponents:[]});
const setup=()=>{
  const inventory=new KudoInventory(registry),containers=new KudoContainers(inventory,registry);
  containers.open({windowId:3,inventoryType:0,windowTitle:{type:'compound',value:{text:{type:'string',value:'Режимы'}}}});
  const items=Array.from({length:45},()=>({itemCount:0}));items[2]={...raw('diamond_sword'),components:[{type:'custom_name',data:{type:'string',value:'§aВыживание'}},{type:'lore',data:[{type:'string',value:'Нажми для входа'}]}]};
  containers.updateWindow({windowId:3,stateId:1,items});return {inventory,containers};
};
test('server menus expose translated text, lore and selectors without guessing clicks',()=>{
  const c=setup(),m=observeMenu(c.containers);assert.equal(m.title,'Режимы');assert.equal(m.slots[2].name,'Выживание');
  assert.equal(findMenuSlot(m,{contains:'входа'}).slot,2);assert.throws(()=>findMenuSlot(m,{}),/Укажи/);
  assert.equal(menuText({text:'A',extra:[{text:'B'}]}),'AB');assert.equal(menuText('{"text":"§cКрасный"}'),'Красный');
});
test('menu click refuses stale observations and reports a resync separately from an effect',async()=>{
  const c=setup(),m=observeMenu(c.containers),selected=findMenuSlot(m,{item:'diamond_sword'}),packets=[];
  c.write=(name,p)=>{packets.push({name,p});c.containers.revision++;};c.waitFor=async predicate=>assert.equal(predicate(),true);
  await assert.rejects(clickMenu(c,{...selected,revision:0},new AbortController().signal),/изменилось/);assert.equal(packets.length,0);
  const result=await clickMenu(c,selected,new AbortController().signal);assert.equal(result.responseObserved,true);assert.equal(result.menuChanged,false);assert.equal(packets[0].p.slot,2);
});
test('custom menu selectors reject ambiguous icons',()=>{
  const c=setup(),w=c.containers.current;w.slots[3]={...w.slots[2],slot:3};
  assert.throws(()=>findMenuSlot(observeMenu(c.containers),{contains:'Выживание'}),/найдено 2/);
});
test('unsupported server menu layouts are observed without becoming executable workstations',()=>{
  const c=setup();c.containers.open({windowId:5,inventoryType:999,windowTitle:'Custom'});
  assert.equal(c.containers.updateWindow({windowId:5,stateId:1,items:Array.from({length:41},()=>({itemCount:0}))}),true);
  assert.equal(observeMenu(c.containers).slots.length,5);assert.equal(c.containers.current.kind,'unsupported');
});
test('unsolicited menus remain open and passengers are acknowledged by server packets',async()=>{
  const protocol=new EventEmitter(),packets=[];Object.assign(protocol,{state:'play',end(){protocol.emit('end');},write(name,p){packets.push({name,p});}});
  const c=new KudoConnect({},{createProtocolClient:()=>protocol});c.world.columnAt=()=>({});const connecting=c.connect();
  protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});protocol.emit('position',{x:0,y:64,z:0,yaw:0,pitch:0,flags:0,teleportId:1});protocol.emit('update_health',{health:20,food:20});await connecting;
  protocol.emit('open_window',{windowId:2,inventoryType:0,windowTitle:'Choose'});assert.equal(c.menu().title,'Choose');assert.equal(packets.some(p=>p.name==='close_window'),false);
  c.entities.set(7,{name:'minecart',position:{x:2,y:64,z:0},velocity:{x:0,y:0,z:0}});
  protocol.emit('set_passengers',{entityId:7,passengers:[1]});assert.equal(c.vehicle().entityId,'7');
  await assert.rejects(c.execute({skill:'navigate',args:{x:3,y:64,z:0}}),/dismount/);
  protocol.emit('set_passengers',{entityId:7,passengers:[]});assert.equal(c.vehicle(),null);await c.close();
});
test('transport mounting and dismounting require authoritative passenger changes',async()=>{
  const c={state:{entityId:1,position:{x:0,y:64,z:0},velocity:{x:0,y:0,z:0}},entities:new Map([[7,{name:'boat',position:{x:2,y:64,z:0},velocity:{x:0,y:0,z:0}}]]),world:{},control:{},stopMovement(){this.control={};},lookAt(){},waitForLook:async()=>{},write(name){if(name==='use_entity')this.state.vehicleId=7;},async waitFor(predicate){assert.equal(predicate(),true);},syncSneak(){if(this.control.sneak)this.state.vehicleId=null;}};
  const result=await mountVehicle(c,{entityId:'7'},new AbortController().signal);assert.equal(result.vehicle.serverConfirmed,true);
  synchronizeVehicle(c);assert.equal(c.state.position.x,2);assert.equal(c.state.position.y,64.45);
  await dismountVehicle(c,new AbortController().signal);assert.equal(c.state.vehicleId,null);
  await assert.rejects(mountVehicle(c,{entityId:'999'},new AbortController().signal),/наблюдаемая/);
});
