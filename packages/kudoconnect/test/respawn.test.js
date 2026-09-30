import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { KudoConnect } from '../index.js';
test('dead login remains observable; explicit respawn waits for world, position and health',async()=>{
  const protocol=new EventEmitter();protocol.state='play';protocol.end=()=>protocol.emit('end');
  const packets=[];protocol.write=(name,p)=>{packets.push({name,p});if(name==='client_command')queueMicrotask(()=>{
    protocol.emit('respawn',{worldState:{name:'minecraft:overworld',gamemode:0}});
    protocol.emit('position',{x:5,y:64,z:5,yaw:0,pitch:0,flags:0,teleportId:2});
    assert.notEqual(c.state.status,'ready');protocol.emit('update_health',{health:20,food:20});
  });};
  const c=new KudoConnect({}, {createProtocolClient:()=>protocol});c.world.columnAt=()=>({});
  const connecting=c.connect();protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});protocol.emit('update_health',{health:0,food:20});await connecting;
  assert.equal(c.state.status,'dead');assert.equal(c.connectionAbort.signal.aborted,true);
  c.state.sleeping=true;c.selfMetadata={pose:2};
  const old=c.connectionAbort;const result=await c.respawn();assert.equal(result.status,'ready');assert.equal(result.health,20);assert.equal(old.signal.aborted,true);assert.notEqual(old,c.connectionAbort);
  assert.equal(c.state.sleeping,false);assert.deepEqual(c.selfMetadata,{});
  assert.equal(packets.filter(p=>p.name==='client_command').length,1);assert.equal(c.entities.size,0);await c.close();
});
test('respawn rejects living clients and already cancelled requests',async()=>{
  const c=new KudoConnect();await assert.rejects(c.respawn(),/погибшему/);
  c.state.status='dead';c.client={state:'play',end(){}};
  await assert.rejects(c.respawn({signal:AbortSignal.abort(new Error('stop'))}),/stop/);assert.equal(c.respawnRequested,false);await c.close();
});
test('dimension travel preserves inventory and health and waits for a new position',async()=>{
  const protocol=new EventEmitter();protocol.state='play';protocol.write=()=>{};protocol.end=()=>protocol.emit('end');
  const c=new KudoConnect({}, {createProtocolClient:()=>protocol});c.world.columnAt=()=>({});
  const connecting=c.connect();protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});
  protocol.emit('position',{x:0,y:64,z:0,yaw:0,pitch:0,flags:0,teleportId:1});protocol.emit('update_health',{health:17,food:15});await connecting;
  const inventory=c.inventory;c.dimensionRequested='minecraft:the_nether';
  protocol.emit('respawn',{worldState:{name:'minecraft:the_nether',gamemode:0}});
  assert.equal(c.state.status,'connecting');assert.equal(c.state.health,17);assert.equal(c.inventory,inventory);assert.equal(c.connectionAbort.signal.aborted,false);
  protocol.emit('position',{x:5,y:70,z:8,yaw:0,pitch:0,flags:0,teleportId:2});
  assert.equal(c.state.status,'ready');assert.equal(c.state.dimension,'minecraft:the_nether');await c.close();
});
