import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createLegacyClickBridge} from '../src/legacy-clicks.js';

const stack=(name,count,slot)=>({name,item:'minecraft:'+name,count,slot,raw:{blockId:1,itemCount:count,itemDamage:0}});
function client(){const c=new EventEmitter();c.registry={version:{version:47},itemsByName:{apple:{id:260,stackSize:64},oak_planks:{id:5,stackSize:64}}};c.inventory={slots:Array(45).fill(null),cursor:null,revision:0,snapshot:()=>({})};c.containers={current:null,revision:0};c.pending={abort:new AbortController()};return c;}

test('legacy clicks change prediction only after an accepted matching transaction and ignore duplicate confirmations',()=>{
  const c=client(),bridge=createLegacyClickBridge(c);c.inventory.slots[36]=stack('apple',5,36);
  const first=bridge.encode({windowId:0,slot:36,mouseButton:1,mode:0});assert.equal(c.inventory.slots[36].count,5);assert.equal(c.inventory.cursor,null);
  bridge.confirm({windowId:0,action:first.action,accepted:true});assert.equal(c.inventory.slots[36].count,2);assert.equal(c.inventory.cursor.count,3);
  const second=bridge.encode({windowId:0,slot:9,mouseButton:0,mode:0});bridge.confirm({windowId:0,action:second.action,accepted:true});bridge.confirm({windowId:0,action:second.action,accepted:true});
  assert.equal(c.inventory.slots[9].count,3);assert.equal(c.inventory.cursor,null);
  assert.throws(()=>bridge.encode({windowId:4,slot:0,mouseButton:0,mode:0}),/open window/);
  assert.throws(()=>bridge.encode({windowId:0,slot:500,mouseButton:0,mode:0}),/Invalid/);
  assert.throws(()=>bridge.encode({windowId:0,slot:9,mouseButton:0,mode:1}),/ordinary clicks/);
});

test('rejected legacy craft transactions cannot grant items; accepted results remain opt-in to the exact crafting window',()=>{
  const c=client(),bridge=createLegacyClickBridge(c);c.inventory.slots[0]=stack('oak_planks',4,0);c.inventory.slots[1]=stack('oak_log',1,1);
  c.legacyCraftExpectation={windowId:0,item:'oak_planks',recipe:{count:4,cells:[{x:0,y:0,item:'oak_log'}]}};
  const first=bridge.encode({windowId:0,slot:0,mouseButton:0,mode:1});assert.equal(first.item.blockId,-1);assert.equal(c.inventory.slots[9],null);
  bridge.confirm({windowId:0,action:first.action,accepted:false});assert.equal(c.inventory.slots[9],null);assert.equal(c.inventory.slots[1].count,1);assert.equal(c.pending.abort.signal.aborted,true);
  c.pending={abort:new AbortController()};const next=bridge.encode({windowId:0,slot:0,mouseButton:0,mode:1});bridge.confirm({windowId:0,action:next.action,accepted:true});
  assert.equal(c.inventory.slots[9].count,4);assert.equal(c.inventory.slots[1],null);assert.equal(c.inventory.cursor,null);
});
