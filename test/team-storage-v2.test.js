import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTeamStorageAllocator} from '../src/team-storage.js';
import {createStorageReactor} from '../src/minecraft-brain.js';
import {createAgentManager} from '../src/agent-manager.js';
import {createSwarmCoordinator} from '../src/swarm-coordinator.js';
import {attachSwarmAgent} from '../src/swarm-integration.js';
import {OMConnect} from '../omconnect/index.js';

const dimension='minecraft:overworld',position={x:2,y:1,z:0},names=['Alice','Blake','Charlie'];
const canonical=inventory=>Object.fromEntries(Object.entries(inventory).map(([item,n])=>['minecraft:'+item.replace(/^minecraft:/,''),n]));
const context=(agent,contents)=>({agent,dimension,position,contents:Object.entries(contents).filter(([,count])=>count).map(([item,count])=>({item:'minecraft:'+item,count}))});
function member(name,inventory={},equipment={}){
  const items=canonical(inventory);
  return {options:{username:name},items,state:{status:'ready',health:20,dimension,position:{x:.5,y:1,z:.5}},inventory:{snapshot:()=>({...items}),equipment:()=>equipment},world:{resolveSelectors:selectors=>selectors[0]==='#logs'?['oak_log','birch_log','acacia_log']:undefined}};
}
const make=(clients,options={})=>createTeamStorageAllocator({worldId:'test',clients,...options});

test('sequential fresh allocations distribute six apples and three picks evenly',()=>{
  const clients=names.map(n=>member(n)),s=make(clients),stock={apple:6,iron_pickaxe:3};
  for(const c of clients){const amounts=s.allocate(context(c.options.username,stock));assert.deepEqual(amounts,{'minecraft:apple':2,'minecraft:iron_pickaxe':1});for(const [item,n]of Object.entries(amounts)){stock[item.slice(10)]-=n;c.items[item]=(c.items[item]||0)+n;}}
  assert.deepEqual(stock,{apple:0,iron_pickaxe:0});assert.equal(s.snapshot().calls,3);
});

test('a scarce item is left for the least stocked eligible teammate, independent of caller order',()=>{
  const a=member('Alice',{apple:6}),b=member('Blake'),c=member('Charlie'),s=make([c,b,a]);
  assert.deepEqual(s.allocate(context('Alice',{apple:6})),{});
  assert.deepEqual(s.allocate(context('Blake',{apple:6})),{'minecraft:apple':3});
  assert.deepEqual(s.allocate(context('Charlie',{iron_pickaxe:1})),{});
  assert.deepEqual(s.allocate(context('Alice',{iron_pickaxe:1})),{'minecraft:iron_pickaxe':1});
});

test('bounded needs leave surplus and unrelated decoration in storage',()=>{
  const clients=names.map(n=>member(n)),s=make(clients);
  assert.deepEqual(s.allocate(context('Alice',{apple:64,iron_pickaxe:8,orange_glazed_terracotta:64})),{'minecraft:apple':8,'minecraft:iron_pickaxe':1});
  assert.deepEqual(make(clients,{defaults:false}).allocate(context('Alice',{apple:64})),{});
});

test('worn armor, cursor items and a better owned tool prevent duplicate default withdrawals',()=>{
  const a=member('Alice',{diamond_pickaxe:1},{head:{item:'minecraft:iron_helmet',count:1}}),b=member('Blake');
  a.inventory.cursor={item:'minecraft:shield',count:1};const s=make([a,b]);
  assert.deepEqual(s.allocate(context('Alice',{iron_helmet:2,iron_pickaxe:2,shield:2})),{});
  assert.deepEqual(s.allocate(context('Blake',{iron_helmet:2,iron_pickaxe:2,shield:2})),{'minecraft:iron_helmet':1,'minecraft:iron_pickaxe':1,'minecraft:shield':1});
  const exact=make([a,b],{targets:c=>c===a?{iron_pickaxe:1}:{}});assert.equal(exact.allocate(context('Alice',{iron_pickaxe:2}))['minecraft:iron_pickaxe'],1);
});

test('equivalent wood and food variants share a reserve instead of multiplying it',()=>{
  const a=member('Alice'),s=make([a]);
  const plan=s.allocate(context('Alice',{apple:4,bread:16,birch_log:2,acacia_log:8}));
  assert.equal((plan['minecraft:apple']||0)+(plan['minecraft:bread']||0),8);
  assert.equal((plan['minecraft:acacia_log']||0)+(plan['minecraft:birch_log']||0),4);
  a.items['minecraft:bread']=8;assert.deepEqual(s.allocate(context('Alice',{apple:16})),{});
});

test('class targets count all owned species and exact zero overrides default collection',()=>{
  const a=member('Alice',{birch_log:7}),s=make([a],{defaults:false,targets:()=>({'#logs':10,apple:0})});
  assert.deepEqual(s.allocate(context('Alice',{acacia_log:12,oak_log:12,apple:6})),{'minecraft:acacia_log':3});
  assert.throws(()=>make([a],{targets:()=>({'#missing':1})}).allocate(context('Alice',{apple:6})),/Register/);
});

test('dead, distant and other-dimension agents do not reserve local supplies',()=>{
  const clients=names.map(n=>member(n));clients[1].state.dimension='minecraft:the_nether';clients[2].state.position.x=100;
  const s=make(clients);assert.deepEqual(s.allocate(context('Alice',{apple:6})),{'minecraft:apple':6});
  clients[1].state.dimension=dimension;clients[1].state.health=0;assert.equal(s.allocate(context('Alice',{apple:6}))['minecraft:apple'],6);
  assert.throws(()=>s.allocate(context('Charlie',{apple:6})),/eligible/);
});

test('allocation validates aliases, counts, members and budgets before returning quantities',()=>{
  const a=member('Alice');assert.throws(()=>make([a,a]),/unique/);assert.throws(()=>make([a],{maxDistance:1000}),/configuration/);
  const s=make([a]);assert.throws(()=>s.allocate(context('Other',{apple:1})),/Unknown/);
  assert.throws(()=>s.allocate({...context('Alice',{apple:1}),contents:Array(129).fill({item:'apple',count:1})}),/bounded/);
  assert.throws(()=>s.allocate(context('Alice',{apple:-1})),/quantity/);
  assert.throws(()=>make([a],{targets:()=>({apple:1,'minecraft:apple':2})}).allocate(context('Alice',{apple:6})),/aliases/);
  assert.throws(()=>make([a],{targets:()=>({apple:4097})}).allocate(context('Alice',{apple:6})),/quantities/);
  assert.throws(()=>make([{...a,options:{}}]),/unique/);
  a.world.resolveSelectors=()=>['oak_log'];
  assert.throws(()=>make([a],{targets:()=>Object.fromEntries(Array.from({length:17},(_,i)=>['#group'+i,1]))}).allocate(context('Alice',{apple:6})),/budget/);
});

test('twenty members receive bounded shares and retained diagnostic plans stay bounded',()=>{
  const clients=Array.from({length:20},(_,i)=>member('Member'+String(i).padStart(2,'0'))),s=make(clients,{defaults:false,targets:()=>({diamond:4096})});
  for(const c of clients)assert.equal(s.allocate(context(c.options.username,{diamond:1000}))['minecraft:diamond'],50);
  assert.equal(s.snapshot().plans.length,20);
  let current=member('Dynamic0');const dynamic=make(()=>[current],{defaults:false,targets:()=>({diamond:1})});
  for(let i=0;i<25;i++){current=member('Dynamic'+i);dynamic.allocate(context(current.options.username,{diamond:1}));}assert.equal(dynamic.snapshot().plans.length,20);
});

test('max-min filling matches a unit-by-unit oracle across changing holdings and needs',()=>{
  let seed=17;const random=n=>{seed=(1664525*seed+1013904223)>>>0;return seed%n;};
  for(let trial=0;trial<120;trial++){
    const clients=names.map(n=>member(n,{diamond:random(8)})),goals=Object.fromEntries(names.map(n=>[n,random(12)])),stock=random(20),expected=[0,0,0];
    for(let left=stock;left>0;left--){const eligible=clients.map((c,i)=>({i,name:c.options.username,held:c.items['minecraft:diamond']+expected[i]})).filter(r=>r.held<goals[r.name]).sort((a,b)=>a.held-b.held||a.name.localeCompare(b.name));if(!eligible.length)break;expected[eligible[0].i]++;}
    const s=make(clients,{defaults:false,targets:c=>({diamond:goals[c.options.username]})});
    assert.deepEqual(clients.map(c=>s.allocate(context(c.options.username,{diamond:stock}))['minecraft:diamond']||0),expected);
  }
});

test('allocator attachments and diagnostics cannot modify server inventory or retained plans',()=>{
  const clients=[member('Alice')],s=make(clients),detach=s.attach(clients[0]);
  assert.throws(()=>s.attach(clients[0]),/already/);const plan=clients[0].storagePolicy.allocate(context('Alice',{apple:2}));plan['minecraft:apple']=99;
  const snapshot=s.snapshot();snapshot.plans[0].amounts['minecraft:apple']=88;assert.equal(s.snapshot().plans[0].amounts['minecraft:apple'],2);assert.deepEqual(clients[0].items,{});
  const hook=clients[0].storagePolicy;detach();detach();assert.equal(clients[0].storagePolicy,undefined);assert.throws(()=>hook.allocate(context('Alice',{apple:2})),/detached/);
});

function wireChest(c,stock,{ack=true}={}){
  const packets=[],raw=(name,count)=>count?{itemCount:count,itemId:c.registry.itemsByName[name].id,components:[],removeComponents:[]}:{itemCount:0};
  let slots,cursor={itemCount:0},revision=0;
  const sync=()=>{stock.splice(0,stock.length,...slots.slice(0,27).map(s=>({...s})));c.containers.updateWindow({windowId:2,stateId:++revision,items:slots,carriedItem:cursor});c.emit('container');};
  c.waitForLook=async()=>{};c.world.blockAt=p=>p.x===2&&p.y===1?{name:'chest',shapes:[[0,0,0,1,1,1]]}:{name:'air',shapes:[]};
  c.client={state:'play',end(){},write(name,p){
    packets.push({name,p});
    if(name==='block_place'){
      slots=[...Array.from({length:27},(_,i)=>stock[i]||raw('apple',0)),...Array.from({length:36},(_,i)=>c.inventory.slots[i+9]?.raw||raw('apple',0))];cursor=raw('apple',0);
      c.containers.open({windowId:2,inventoryType:2});sync();
    }
    if(name==='window_click'&&ack){
      if(p.mode===1){const source=slots[p.slot],target=slots.findIndex((s,i)=>i>=27&&!s.itemCount);slots[target]={...source};slots[p.slot]=raw('apple',0);}
      else if(p.mouseButton===0){if(cursor.itemCount){slots[p.slot]={...cursor};cursor=raw('apple',0);}else{cursor={...slots[p.slot]};slots[p.slot]=raw('apple',0);}}
      else{slots[p.slot]={...cursor,itemCount:(slots[p.slot]?.itemCount||0)+1};cursor={...cursor,itemCount:cursor.itemCount-1};}
      sync();
    }
  }};
  return {packets,raw};
}
function connected(name){const c=new OMConnect({username:name});Object.assign(c.state,{status:'ready',health:20,food:20,onGround:true,dimension,position:{x:.5,y:1,z:.5}});return c;}

test('concurrent confirmed chest operations serialize and recompute fair shares from fresh slots',async()=>{
  const clients=names.map(connected),stock=[],s=make(clients),coordinator=createSwarmCoordinator({worldId:'test',members:names}),detach=[];
  const fixtures=clients.map(c=>wireChest(c,stock));stock.push(fixtures[0].raw('apple',6),fixtures[0].raw('iron_pickaxe',1),fixtures[0].raw('iron_pickaxe',1),fixtures[0].raw('iron_pickaxe',1));
  for(const c of clients)detach.push(s.attach(c),attachSwarmAgent(c,{coordinator}));
  try{
    const receipts=await Promise.all(clients.map(c=>c.execute({skill:'takeStorage',args:{...position,allocation:'team-supplies'}},{signal:AbortSignal.timeout(5000)})));
    for(let i=0;i<clients.length;i++){assert.equal(clients[i].inventory.count('apple'),2);assert.equal(clients[i].inventory.count('iron_pickaxe'),1);assert.equal(receipts[i].serverConfirmed,true);assert.equal(clients[i].containers.current,null);}
    assert.equal(stock.reduce((n,s)=>n+(s.itemCount||0),0),0);assert.equal(coordinator.snapshot().active,0);assert.ok(coordinator.snapshot().conflicts>0);
    assert.ok(fixtures.some(f=>f.packets.some(p=>p.name==='window_click'&&p.p.mouseButton===1)),'Exact partial stacks use confirmed clicks');
  }finally{for(const d of detach)d();await Promise.all(clients.map(c=>c.close()));coordinator.close();}
});

test('a zero allocation closes the window without falling back to take-all',async()=>{
  const c=connected('Alice'),stock=[],fixture=wireChest(c,stock),s=make([c],{defaults:false}),detach=s.attach(c);stock.push(fixture.raw('apple',6));
  try{const receipt=await c.execute({skill:'takeStorage',args:{...position,allocation:'team-supplies'}});assert.deepEqual(receipt.transferred,[]);assert.equal(receipt.reason,'allocation-satisfied');assert.equal(c.inventory.count('apple'),0);assert.ok(!fixture.packets.some(p=>p.name==='window_click'));assert.equal(c.containers.current,null);}
  finally{detach();await c.close();}
});

test('allocation reads the confirmed open window rather than remembered chest stock',async()=>{
  const c=connected('Alice'),stock=[],fixture=wireChest(c,stock);stock.push(fixture.raw('apple',2));c.containers.observations.set('stale',{contents:[{item:'minecraft:apple',count:99}]});
  c.storagePolicy={id:'probe',allocate:ctx=>{assert.equal(ctx.serverConfirmed,true);assert.equal(ctx.contents[0].count,2);return {apple:2};}};
  try{const result=await c.execute({skill:'takeStorage',args:{...position,allocation:'probe'}});assert.equal(result.transferred[0].count,2);}
  finally{await c.close();}
});

test('unknown or invalid allocation policies cannot dispatch inventory clicks',async()=>{
  const c=connected('Alice'),stock=[],fixture=wireChest(c,stock);stock.push(fixture.raw('apple',2));
  try{
    await assert.rejects(c.execute({skill:'takeStorage',args:{...position,allocation:'missing'}}),/installed/);assert.equal(fixture.packets.length,0);
    for(const planned of [{apple:0},{apple:2,'minecraft:apple':1},Promise.resolve({apple:2})]){
      c.storagePolicy={id:'probe',allocate:()=>planned};await assert.rejects(c.execute({skill:'takeStorage',args:{...position,allocation:'probe'}}),/allocation/);assert.equal(c.containers.current,null);
    }
    assert.equal(c.inventory.count('apple'),0);assert.ok(!fixture.packets.some(p=>p.name==='window_click'));
  }finally{await c.close();}
});

test('explicit filters and quantity ceilings constrain a dynamic allocation',async()=>{
  const c=connected('Alice'),stock=[],fixture=wireChest(c,stock);stock.push(fixture.raw('apple',3),fixture.raw('bread',3));
  c.storagePolicy={id:'probe',allocate:ctx=>{assert.deepEqual(ctx.contents.map(s=>s.name),['bread']);return {bread:3,apple:3};}};
  try{const result=await c.execute({skill:'takeStorage',args:{...position,allocation:'probe',items:['bread'],amounts:{bread:1}}});assert.deepEqual(result.transferred,[{item:'minecraft:bread',count:1}]);assert.equal(c.inventory.count('apple'),0);}
  finally{await c.close();}
});

test('team storage reactor selects bounded allocation ahead of ordinary gathering',()=>{
  const observation={dimension,self:{health:20,position:{x:.5,y:1,z:.5}},world:{sampledBlocks:[{name:'minecraft:chest',position}]}};
  const plan=createStorageReactor({mode:'team'}).react(observation);assert.equal(plan.action.skill,'takeStorage');assert.equal(plan.action.args.allocation,'team-supplies');assert.equal(plan.priority,35);
  assert.equal(createStorageReactor().react(observation).action.skill,'lootChest');assert.throws(()=>createStorageReactor({mode:'invalid'}),/policy/);
});

test('manager installs team allocation by default and preserves explicit all/disabled policies',async()=>{
  for(const storage of [undefined,{mode:'all'},false]){
    let configured;const manager=createAgentManager({names:['Alice','Blake'],count:2,brainOptions:{storage},createClient:o=>connected(o.username),createBrain:o=>{configured=o.storage;return Object.assign(new EventEmitter(),{start(){},async stop(){},snapshot:()=>({})});}});
    try{await manager.execute('Alice','start');assert.deepEqual(configured,storage===undefined?{mode:'team'}:storage);assert.ok(manager.entries.get('Alice').client.storagePolicy);assert.equal(manager.snapshot().storageAllocation.policyId,'team-supplies');}
    finally{await manager.close();}assert.equal(manager.entries.get('Alice').client.storagePolicy,undefined);
  }
});

test('resource scenario class demands remain interchangeable in the manager allocation policy',async()=>{
  let reactor;const manager=createAgentManager({names:['Alice'],count:1,cooperation:true,createClient:o=>connected(o.username),createBrain:o=>{reactor=o.reactors[0];return Object.assign(new EventEmitter(),{start(){},async stop(){},snapshot:()=>({})});}});
  try{
    await manager.execute('Alice','tasks',{tasks:[{id:'wood',title:'Get nearby wood',type:'scenario',scenario:{schemaVersion:1,name:'Wood',steps:[{id:'logs',type:'resources',targets:{'#logs':10}}]}}]});
    await manager.execute('Alice','start');const c=manager.entries.get('Alice').client;
    c.world.blockAt=p=>c.world.Block.fromStateId(c.registry.blocksByName[p.y<1?'dirt':'air'].defaultState,0);
    reactor.react({dimension,self:c.state,inventory:{},world:{sampledBlocks:[]}});
    const plan=c.storagePolicy.allocate({...context('Alice',{acacia_log:12}),serverConfirmed:true});assert.equal(plan['minecraft:acacia_log'],10);
  }finally{await manager.close();}
});
