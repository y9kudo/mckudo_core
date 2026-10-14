import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from 'minecraft-protocol';
import data from 'minecraft-data';
import {createVersionAPI,versionSupport,normalizeSlot,registerVersionProfile,resolveVersionProfile} from '../index.js';
import {routeFacingTarget} from '../src/route-facing.js';
import {gazeAngles} from '../src/players.js';

test('every installed transport version round-trips normalized movement through its actual wire codec',()=>{
  const state={position:{x:2.5,y:64,z:-3.5},yaw:35,pitch:12,onGround:true};
  for(const version of protocol.supportedVersions){
    const api=createVersionAPI(version),packet=api.movement(state),buffer=protocol.createSerializer({state:'play',isServer:false,version}).createPacketBuffer(packet),decoded=protocol.createDeserializer({state:'play',isServer:true,version}).parsePacketBuffer(buffer).data;
    assert.equal(decoded.name,'position_look',version);assert.equal(decoded.params.x,2.5,version);assert.equal(decoded.params.z,-3.5,version);assert.equal(decoded.params.yaw,35,version);assert.ok(api.loadRegistry().itemsArray.length>0,version);
    for(const [name,value]of Object.entries(decoded.params))if(typeof value==='number')assert.ok(Number.isFinite(value),`${version}/${name}`);
    if(version==='1.7')assert.equal(decoded.params.stance,65.62);
  }
});
test('version API shares wire-compatible patch releases and separates catalog/transport from native gameplay',()=>{
  for(const v of ['1.8','1.16.5','1.18.2','1.19.4','1.20.4','1.21.1'])assert.equal(versionSupport(v).transport,true,v);
  assert.equal(versionSupport('1.16.5').native,false);assert.equal(createVersionAPI('1.8').capabilities().teleportConfirmation,false);assert.equal(createVersionAPI('1.20.4').capabilities().teleportConfirmation,true);
  assert.throws(()=>createVersionAPI('not-a-version'));assert.equal(versionSupport('26.3').liveTested,false);
});
test('legacy login dimensions and slots are normalized without mutating authoritative packets',()=>{
  const api=createVersionAPI('1.16.5'),packet={entityId:1,gameMode:0,dimension:-1};assert.equal(api.normalize('login',packet).worldState.name,'minecraft:the_nether');assert.equal(packet.worldState,undefined);
  assert.deepEqual(normalizeSlot({present:true,itemId:5,itemCount:2}),{present:true,itemId:5,itemCount:2});assert.equal(normalizeSlot({present:false}),null);assert.equal(normalizeSlot({blockId:-1}),null);assert.equal(normalizeSlot({blockId:5,itemCount:2}).itemId,5);
});
test('custom version profiles are registered explicitly and cannot replace verified native profiles',()=>{
  const p={version:'test-profile',loadRegistry:()=>data('1.21.1'),createProtocolClient:options=>({version:options.version})};const undo=registerVersionProfile(p);assert.equal(resolveVersionProfile(p.version).version,p.version);assert.equal(createVersionAPI(p.version).capabilities().profile,true);assert.equal(createVersionAPI(p.version).createTransport({username:'Atlas'}).version,p.version);assert.throws(()=>registerVersionProfile(p));undo();assert.equal(resolveVersionProfile(p.version),null);assert.throws(()=>createVersionAPI(p.version));assert.throws(()=>registerVersionProfile({...p,version:'1.21.1'}));
});
test('descending route retains its heading even after overshooting the waypoint',()=>{
  const from={x:0,y:66,z:0},to={x:2,y:64,z:0};
  for(const position of [{x:.5,y:66,z:.5},{x:2.7,y:65,z:.5},{x:2.5,y:64,z:.5}]){
    const target=routeFacingTarget({position,yaw:-90},from,to),angle=gazeAngles({...position,y:position.y+1.62},target);
    assert.equal(angle.yaw,-90);assert.equal(Math.abs(angle.pitch),0);
  }
});
