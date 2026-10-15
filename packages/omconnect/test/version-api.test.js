import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from 'minecraft-protocol';
import data from 'minecraft-data';
import {createVersionAPI,versionSupport,normalizeSlot,registerVersionProfile,resolveVersionProfile,discoverOfficialJavaVersions,inspectOfficialJavaVersion,OFFICIAL_VERSION_MANIFEST,createVanillaCompatibilityProfile} from '../index.js';
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
test('every installed transport encodes block digging with its own sequence format',()=>{
  for(const version of protocol.supportedVersions){
    const api=createVersionAPI(version),packet=api.digging({position:{x:5,y:64,z:-3},phase:'start',face:1,sequence:42});
    const buffer=protocol.createSerializer({state:'play',isServer:false,version}).createPacketBuffer(packet);
    const decoded=protocol.createDeserializer({state:'play',isServer:true,version}).parsePacketBuffer(buffer).data;
    assert.equal(decoded.name,'block_dig',version);
    assert.equal(decoded.params.status,0,version);
    assert.deepEqual(decoded.params.location,{x:5,y:64,z:-3},version);
    assert.equal(decoded.params.sequence,api.loadRegistry().protocol.play.toServer.types.packet_block_dig[1].some(field=>field.name==='sequence')?42:undefined,version);
  }
  assert.throws(()=>createVersionAPI('1.20.4').digging({position:{x:0.5,y:64,z:0},phase:'start'}));
  assert.throws(()=>createVersionAPI('1.20.4').digging({position:{x:0,y:64,z:0},phase:'invalid'}));
});
test('official discovery includes historical releases while keeping unsupported protocols explicit',async()=>{
  const versions=await discoverOfficialJavaVersions({fetchImpl:async url=>{
    assert.equal(url,OFFICIAL_VERSION_MANIFEST);
    return {ok:true,json:async()=>({versions:[
      {id:'26.3',type:'release',releaseTime:'2026-09-15T00:00:00Z'},
      {id:'1.0.0',type:'release',releaseTime:'2011-11-18T00:00:00Z'},
      {id:'b1.8.1',type:'old_beta',releaseTime:'2011-09-19T00:00:00Z'},
      {id:'26.4-snapshot-1',type:'snapshot'}
    ]})};
  }});
  assert.equal(versions.length,3);
  assert.equal(versions[0].transport,false);
  assert.equal(versions[1].known,true);
  assert.equal(versions[2].transport,false);
  assert.deepEqual((await discoverOfficialJavaVersions({includeLegacy:false,fetchImpl:async()=>({ok:true,json:async()=>({versions:[{id:'1.0.0',type:'release'},{id:'b1.8.1',type:'old_beta'}]})})})).map(v=>v.version),['1.0.0']);
});
test('official server inspection distinguishes a downloadable server from gameplay support',async()=>{
  const metadata='https://piston-meta.mojang.com/v1/packages/example/1.20.4.json';
  const fetchImpl=async url=>({ok:true,json:async()=>url===OFFICIAL_VERSION_MANIFEST?{versions:[{id:'1.20.4',type:'release',url:metadata}]}:{downloads:{server:{url:'https://piston-data.mojang.com/v1/objects/example/server.jar',sha1:'0123456789abcdef',size:123}}}});
  const result=await inspectOfficialJavaVersion('1.20.4',{fetchImpl});
  assert.equal(result.officialServer,true);
  assert.equal(result.support.transport,true);
  assert.equal(result.support.native,false);
  assert.equal(result.serverDownload.size,123);
  assert.throws(()=>createVanillaCompatibilityProfile('26.3'),/transport/);
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
