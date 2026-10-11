import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { KudoConnect } from '../index.js';
import { authenticationOptions } from '../src/auth.js';

test('Microsoft accepts account identifiers; offline requires a Minecraft nickname',()=>{
  assert.doesNotThrow(()=>new KudoConnect({auth:'microsoft',username:'alice@example.test'}));
  assert.throws(()=>new KudoConnect({username:'alice@example.test'}),/Offline/);
  for(const key of ['password','session','accessToken'])assert.throws(()=>new KudoConnect({auth:'microsoft',[key]:'secret'}),/password\/session\/accessToken/);
  assert.throws(()=>new KudoConnect({auth:'invalid'}),/auth/);
  assert.throws(()=>new KudoConnect({auth:'offline',realms:{realmId:1}}),/Realms/);
  assert.throws(()=>new KudoConnect({auth:'microsoft',realms:{realmId:0}}),/realmId/);
});
test('auth callback exposes only the user code and stops after cancellation',()=>{
  const codes=[];let closed=false;
  const o=authenticationOptions({auth:'microsoft',username:'account',onMsaCode:x=>codes.push(x)},{isClosed:()=>closed});
  assert.ok(o.profilesFolder.endsWith('kudoconnect\\auth')||o.profilesFolder.endsWith('kudoconnect/auth'));
  o.onMsaCode({user_code:'ABCD',device_code:'never-share',verification_uri:'https://www.microsoft.com/link',expires_in:900});
  assert.deepEqual(Object.keys(codes[0]).sort(),['expires_in','user_code','verification_uri']);
  closed=true;o.onMsaCode({user_code:'late'});assert.equal(codes.length,1);
});
function mock(options={}){
  let config,connections=0;const protocol=new EventEmitter();Object.assign(protocol,{state:'play',write(){},end(){protocol.emit('end','closed');}});
  const c=new KudoConnect({auth:'microsoft',username:'account',...options},{createProtocolClient:o=>{config=o;o.connect=()=>connections++;return protocol;}});
  c.world.columnAt=()=>({});
  return {c,protocol,get config(){return config;},get connections(){return connections;}};
}
const profile={name:'AliceOnline',id:'a'.repeat(32)};
test('Microsoft auth is separate from spawn readiness and never forwards tokens',async()=>{
  const m=mock(),connecting=m.c.connect(),publicEvents=[];m.c.on('authenticated',x=>publicEvents.push(x));
  m.protocol.emit('session',{accessToken:'SECRET_TOKEN',selectedProfile:profile});
  assert.equal(m.c.state.status,'connecting');
  m.protocol.emit('login',{entityId:1,worldState:{name:'minecraft:overworld',gamemode:0}});
  m.protocol.emit('position',{x:0,y:64,z:0,yaw:0,pitch:0,flags:0,teleportId:1});m.protocol.emit('update_health',{health:20,food:20});
  await connecting;assert.equal(m.c.snapshot().authentication.profile.name,'AliceOnline');assert.equal(JSON.stringify(m.c.snapshot()).includes('SECRET_TOKEN'),false);
  assert.deepEqual(publicEvents,[{name:'AliceOnline',uuid:'a'.repeat(32)}]);await m.c.close();
});
test('closing while device login is pending prevents a late server connection',async()=>{
  const m=mock(),connecting=m.c.connect();const rejected=assert.rejects(connecting,/остановлен|закрыто/);
  await m.c.close();await rejected;
  m.protocol.emit('session',{accessToken:'late-secret',selectedProfile:profile});m.config.connect(m.protocol);
  assert.equal(m.connections,0);assert.equal(m.c.authentication.profile,null);assert.equal(m.c.state.status,'disconnected');
});
test('invalid licensed profile aborts instead of silently falling back to offline',async()=>{
  const m=mock(),connecting=m.c.connect();m.protocol.emit('session',{selectedProfile:{name:'x',id:'bad'}});
  await assert.rejects(connecting,/профиль/);assert.equal(m.c.state.status,'disconnected');
});
