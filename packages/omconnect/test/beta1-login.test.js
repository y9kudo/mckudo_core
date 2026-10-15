import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {OMConnect} from '../index.js';

test('configuration ping, including zero, receives pong before world readiness and does not bypass login',async()=>{
  const protocol=new EventEmitter(),packets=[];
  protocol.state='configuration';protocol.write=(name,p)=>packets.push({name,p});protocol.end=()=>protocol.emit('end');
  const c=new OMConnect({connectTimeoutMs:1000},{createProtocolClient:()=>protocol});
  c.world.columnAt=()=>({});const connecting=c.connect();
  protocol.emit('ping',{id:0});protocol.emit('ping',{id:-2147483648});
  assert.deepEqual(packets.map(p=>p.name),['pong','pong']);assert.equal(packets[0].p.id,0);
  assert.equal(c.state.status,'connecting');
  protocol.state='play';protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});
  protocol.emit('position',{x:0,y:64,z:0,yaw:0,pitch:0,flags:0,teleportId:1});
  protocol.emit('update_health',{health:20,food:20});await connecting;
  protocol.emit('ping',{id:42});assert.equal(packets.at(-1).name,'pong');assert.equal(packets.at(-1).p.id,42);
  await c.close();const count=packets.length;protocol.emit('ping',{id:1});assert.equal(packets.length,count);
});
