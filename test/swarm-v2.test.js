import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {EventEmitter} from 'node:events';
import {createSwarmCoordinator} from '../src/swarm-coordinator.js';
import {attachSwarmAgent} from '../src/swarm-integration.js';
import {createNavigationCoordination} from '../packages/omconnect/src/navigation-coordination.js';
import {executeNavigate} from '../packages/omconnect/src/movement.js';
import {stepPhysics} from '../packages/omconnect/src/physics.js';
import {createAgentManager} from '../src/agent-manager.js';
import {OMConnect} from '../omconnect/index.js';
import {OMPeer} from '../packages/omconnect/src/peers.js';
import {createSurvivalReactor} from '../src/survival-brain.js';
import {catalogFromMinecraftData} from '../src/catalog.js';

const dim='minecraft:overworld',members=['Alice','Blake','Charlie'];
const swarm=options=>createSwarmCoordinator({worldId:'test',members,...options});
const request=(agent,resources,dimension=dim)=>({agent,resources,dimension});
const p=(x,z=0,y=1)=>({x,y,z});
function client(name='Alice'){
  const c=new OMConnect({username:name});Object.assign(c.state,{status:'ready',health:20,food:20,onGround:true,dimension:dim,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}});
  return c;
}

test('swarm grants multi-resource leases atomically and scopes them by world and dimension',()=>{
  const s=swarm(),other=swarm({worldId:'other'});
  assert.equal(s.acquire(request('Alice',['a','b'])).status,'granted');
  assert.equal(s.acquire(request('Blake',['b','c'])).status,'blocked');
  assert.equal(s.acquire(request('Charlie',['c'])).status,'blocked','An earlier overlapping waiter has precedence');
  s.cancelWait('Blake');assert.equal(s.acquire(request('Charlie',['c'])).status,'granted','A denied request never holds c');
  assert.equal(s.acquire(request('Blake',['a'],'minecraft:the_nether')).status,'granted');
  assert.equal(other.acquire(request('Blake',['a'])).status,'granted');
  assert.equal(s.snapshot().active,3);
});

test('expiry, replacement tokens, and reconnect cleanup cannot release another grant',()=>{
  let now=0;const s=swarm({clock:()=>now,ttlMs:100});
  const first=s.acquire(request('Alice',['a']));now=101;
  assert.equal(s.renew('Alice',first.token),false);
  const next=s.acquire(request('Alice',['a']));assert.notEqual(next.token,first.token);
  const moved=s.acquire(request('Alice',['b']));assert.notEqual(next.token,moved.token);
  assert.equal(s.release('Alice',next.token),false);assert.equal(s.release('Blake',moved.token),false);
  assert.equal(s.snapshot().active,1);s.releaseAgent('Alice');assert.equal(s.snapshot().active,0);
  s.close();assert.equal(s.release('Alice',moved.token),false);assert.throws(()=>s.acquire(request('Alice',['b'])),/closed/);
});

test('earlier waiters win after release, while existing identical leases can renew',()=>{
  const s=swarm(),held=s.acquire(request('Alice',['a']));
  assert.equal(s.acquire(request('Blake',['a'])).status,'blocked');
  assert.equal(s.acquire(request('Alice',['a'])).token,held.token);
  s.release('Alice',held.token);
  assert.equal(s.acquire(request('Charlie',['a'])).owner,'Blake');
  assert.equal(s.acquire(request('Blake',['a'])).status,'granted');
});

test('path reservations cover reverse edges, diagonal crossings, body and supporting blocks',()=>{
  const s=swarm();
  const a=s.reservePath({agent:'Alice',dimension:dim,positions:[p(0),p(1,1)]});assert.equal(a.status,'granted');
  assert.equal(s.reservePath({agent:'Blake',dimension:dim,positions:[p(1,1),p(0)]}).status,'blocked');
  assert.equal(s.reservePath({agent:'Charlie',dimension:dim,positions:[p(0,1),p(1)]}).status,'blocked');
  assert.equal(s.acquire(request('Blake',['cell/0,0,0'])).status,'blocked');
  s.releaseAgent('Alice');s.cancelWait('Blake','path');s.cancelWait('Charlie','path');
  assert.equal(s.acquire(request('Blake',['cell/0,0,0'])).status,'granted');
});

test('blocked path requests give up their old passage instead of holding it while waiting',()=>{
  const s=swarm();s.reservePath({agent:'Alice',dimension:dim,positions:[p(0),p(1)]});
  s.reservePath({agent:'Blake',dimension:dim,positions:[p(3),p(4)]});
  assert.equal(s.reservePath({agent:'Alice',dimension:dim,positions:[p(2),p(3)]}).status,'blocked');
  assert.equal(s.snapshot().leases.some(l=>l.agent==='Alice'),false);
});

test('swarm budgets and member validation reject malformed and unbounded requests',()=>{
  assert.throws(()=>swarm({members:['Alice','alice']}),/unique/);
  const s=swarm({capacity:1});assert.throws(()=>s.acquire(request('Unknown',['a'])),/member/);
  for(const resources of [[],Array(65).fill('a'),['bad space']])assert.throws(()=>s.acquire(request('Alice',resources)),/Invalid/);
  s.acquire(request('Alice',['a']));assert.equal(s.acquire(request('Blake',['b'])).status,'blocked');
  assert.throws(()=>s.reservePath({agent:'Alice',dimension:dim,positions:[p(1),p(5)]}),/adjacent/);
  assert.throws(()=>s.reservePath({agent:'Alice',dimension:dim,positions:[p(1)],durationMs:0}),/Invalid/);
  assert.throws(()=>s.acquire(request('Alice',['a'],'unknown dimension')),/Invalid/);
});

test('permission hooks cannot fabricate success, dispatch twice, or unlock an active dispatch',async()=>{
  const c=client();let calls=0,done=false;c.registerSkill('probe',async()=>{calls++;await delay(30);done=true;return {ok:true};});
  try{
    c.actionCoordinator={run:async()=>({ok:true})};await assert.rejects(c.execute({skill:'probe'}),/without dispatching/);assert.equal(calls,0);
    c.actionCoordinator={run:async(_a,_ctx,perform)=>{perform();throw new Error('Hook failed');}};
    await assert.rejects(c.execute({skill:'probe'}),/Hook failed/);assert.equal(done,true);assert.equal(c.pending,null);
    c.actionCoordinator={run:async(_a,_ctx,perform)=>{const result=await perform();assert.throws(()=>perform(),/only once/);return result;}};
    assert.deepEqual(await c.execute({skill:'probe'}),{ok:true});assert.equal(calls,2);
  }finally{await c.close();}
});

test('higher-priority cancellation aborts a waiting resource action before physical dispatch',async()=>{
  const c=client(),s=swarm(),detach=attachSwarmAgent(c,{coordinator:s});let digs=0;
  c.skills.set('dig',()=>{digs++;});c.registerSkill('probe',()=>true);
  s.acquire(request('Blake',['cell/1,1,0']));
  const first=c.execute({skill:'dig',args:p(1)});const rejected=assert.rejects(first,/Interrupted/);
  try{await delay(35);await c.execute({skill:'probe'},{priority:10});await rejected;assert.equal(digs,0);assert.equal(s.snapshot().waiting.length,0);}
  finally{detach();await c.close();}
});

test('double chest halves share one lease and detached running actions abort and release it',async()=>{
  const a=client(),b=client('Blake'),s=swarm(),da=attachSwarmAgent(a,{coordinator:s}),db=attachSwarmAgent(b,{coordinator:s,maxWaitMs:0});
  const block=x=>({name:'chest',getProperties:()=>({type:x===0?'left':'right',facing:'north'})});
  a.world.blockAt=p=>p.x===0?block(0):null;b.world.blockAt=p=>p.x===1?block(1):null;
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  a.skills.set('takeStorage',async(_args,{signal})=>{entered();await delay(10000,undefined,{signal});});
  let otherCalls=0;b.skills.set('takeStorage',()=>{otherCalls++;});
  const pending=a.execute({skill:'takeStorage',args:p(0)}),rejected=assert.rejects(pending,/released/);
  try{await started;await assert.rejects(b.execute({skill:'takeStorage',args:p(1)}),e=>e.code==='OCCUPIED');assert.equal(otherCalls,0);da();await rejected;assert.equal(s.snapshot().active,0);}
  finally{da();db();await a.close();await b.close();}
});

test('ground waiting is cancellable and releases waiters and successful path tokens',async()=>{
  const c=client(),s=swarm(),detach=attachSwarmAgent(c,{coordinator:s}),abort=new AbortController();
  s.reservePath({agent:'Blake',dimension:dim,positions:[p(1)]});
  const traffic=createNavigationCoordination(c,abort.signal),pending=traffic.update([p(0),p(1)]),rejected=assert.rejects(pending,/cancel passage|aborted/);
  try{await delay(35);assert.equal(c.metrics.coordinationWaits,1);abort.abort(new Error('cancel passage'));await rejected;traffic.release();assert.equal(s.snapshot().waiting.length,0);
    s.releaseAgent('Blake');const next=createNavigationCoordination(c,new AbortController().signal);await next.update([p(0),p(1)]);assert.equal(s.snapshot().active,1);next.release();assert.equal(s.snapshot().active,0);
  }finally{traffic.release();detach();await c.close();}
});

test('a lost resource lease cancels its in-flight dispatch instead of continuing silently',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const c=client(),s=swarm(),detach=attachSwarmAgent(c,{coordinator:s});let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  c.skills.set('dig',async(_args,{signal})=>{entered();await delay(10000,undefined,{signal});});
  const pending=c.execute({skill:'dig',args:p(1)}),rejected=assert.rejects(pending,e=>e.code==='OCCUPIED');
  try{await started;s.releaseAgent('Alice');t.mock.timers.tick(1000);await rejected;assert.equal(c.pending,null);assert.equal(s.snapshot().active,0);}
  finally{detach();await c.close();t.mock.timers.reset();}
});

test('terrain is rechecked after passage waiting before applying movement controls',async()=>{
  const c=client(),s=swarm(),detach=attachSwarmAgent(c,{coordinator:s});let missing=false;
  const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
  c.world.blockAt=p=>p.y<1&&!(missing&&p.x===1)?stone:air;
  const held=s.reservePath({agent:'Blake',dimension:dim,positions:[p(1)]});
  const change=setTimeout(()=>{missing=true;s.release('Blake',held.token);},75);
  try{await assert.rejects(executeNavigate(c,{x:1,y:1,z:0,range:0,bridge:false},AbortSignal.timeout(2000)),e=>e.code==='SUPPORT_CHANGED');assert.equal(c.control.x,0);assert.equal(s.snapshot().active,0);}
  finally{clearTimeout(change);detach();await c.close();}
});

test('intentional passage waiting does not become a physical-stall failure',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const c=client(),s=swarm({ttlMs:5000}),detach=attachSwarmAgent(c,{coordinator:s,maxWaitMs:5000});
  const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
  c.world.blockAt=p=>p.y<1?stone:air;c.client={state:'play',write(){},end(){}};
  const held=s.reservePath({agent:'Blake',dimension:dim,positions:[p(1)]});
  const timer=setInterval(()=>{c.state=stepPhysics(c.state,c.control,c.world.blockAt);c.tickLook();c.emit('physics');},50);
  const release=setTimeout(()=>{now+=4000;s.release('Blake',held.token);},75);
  try{assert.equal((await executeNavigate(c,{x:1,y:1,z:0,range:0,bridge:false},AbortSignal.timeout(3000))).ok,true);assert.equal(c.metrics.coordinationWaits,1);assert.equal(s.snapshot().active,0);}
  finally{clearTimeout(release);clearInterval(timer);detach();await c.close();}
});

test('coordinated navigation still uses normal physics and releases its sliding window on success',async()=>{
  const c=client(),s=swarm(),detach=attachSwarmAgent(c,{coordinator:s});
  const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
  c.world.blockAt=p=>p.y<1?stone:air;c.client={state:'play',write(){},end(){}};
  const timer=setInterval(()=>{c.state=stepPhysics(c.state,c.control,c.world.blockAt);c.tickLook();c.emit('physics');},50);
  try{const result=await executeNavigate(c,{x:6,y:1,z:0,range:0,bridge:false,sprintJump:false},AbortSignal.timeout(10000));assert.equal(result.ok,true);assert.ok(Math.abs(c.state.position.x-6.5)<.3);assert.ok(s.snapshot().grants>1);assert.equal(s.snapshot().active,0);assert.equal(c.metrics.corrections,0);}
  finally{clearInterval(timer);detach();await c.close();}
});

test('manager enables shared hooks, releases paused claims, and supports explicit opt-out',async()=>{
  const manager=createAgentManager({names:members,count:3,worldId:'team'});
  try{
    await manager.ready;assert.equal(manager.snapshot().cooperation.worldId,'team');
    const c=manager.entries.get('Alice').client;assert.ok(c.actionCoordinator);assert.ok(c.navigationCoordinator);
    manager.fleet.peers.get('Alice').claim('block/minecraft:overworld/1/1/1');
    await manager.execute('Alice','pause');assert.ok(manager.fleet.peers.get('Alice').snapshot().claims.every(c=>c.from!=='Alice'||c.release));
  }finally{await manager.close();}assert.equal(manager.entries.get('Alice').client.navigationCoordinator,undefined);
  const independent=createAgentManager({names:members,count:3,cooperation:false});try{assert.equal(independent.snapshot().cooperation,null);assert.equal(independent.entries.get('Alice').client.actionCoordinator,undefined);}finally{await independent.close();}
});

function resourceFixture(c){
  const position={x:2,y:1,z:0};
  c.world.blockAt=p=>c.world.Block.fromStateId(c.registry.blocksByName[p.x===2&&p.y===1&&p.z===0?'birch_log':p.y<1?'dirt':'air'].defaultState,0);
  return {dimension:dim,self:c.state,inventory:{},world:{sampledBlocks:[{name:'minecraft:birch_log',position}]}};
}

test('an expired mining claim is reacquired instead of leaving its reactor waiting forever',async()=>{
  let now=0;const c=client(),peer=new OMPeer({id:'Alice',team:'test',peers:['Alice'],send(){},settleMs:0,clock:()=>now});
  try{
    const observation=resourceFixture(c),r=createSurvivalReactor({client:c,catalog:catalogFromMinecraftData(c.registry),targets:{'#logs':1},exploration:false,peer});
    assert.equal(r.react(observation).action.skill,'dig');now=31000;assert.equal(r.react(observation).action.skill,'dig');
    assert.ok(peer.snapshot().claims.some(c=>!c.release&&c.expiresAt>now));
  }finally{peer.close();await c.close();}
});

test('resource tasks receive the manager peer and participate in the same mining arbitration',async()=>{
  let reactor;const manager=createAgentManager({count:1,names:['Alice'],createClient:()=>client(),createBrain:options=>{reactor=options.reactors[0];return Object.assign(new EventEmitter(),{snapshot:()=>({running:false}),start(){},async stop(){}});}});
  try{
    const c=manager.entries.get('Alice').client,observation=resourceFixture(c);
    await manager.execute('Alice','tasks',{tasks:[{id:'wood',title:'Gather wood',type:'scenario',scenario:{schemaVersion:1,name:'Wood',steps:[{id:'logs',type:'resources',targets:{'#logs':1}}]}}]});
    await manager.execute('Alice','start');reactor.react(observation);
    assert.ok(manager.fleet.peers.get('Alice').snapshot().claims.some(c=>c.resource==='block/minecraft:overworld/2/1/0'&&!c.release));
  }finally{await manager.close();}
});

test('a manual pause during automatic trade cannot restart the paused brain',async t=>{
  t.mock.timers.enable({apis:['setInterval']});let paused,release;const started=new Promise(resolve=>{paused=resolve;});let waiting=false;
  const manager=createAgentManager({names:['Alice','Blake'],count:2,cooperation:false,supplyTargets:{'minecraft:apple':8},createClient:options=>{
    const c=client(options.username);c.connect=async()=>{c.state.status='ready';};
    c.inventory.snapshot=()=>options.username==='Alice'?{'minecraft:apple':12}:{};return c;
  },createBrain:()=>{let running=false,starts=0;return Object.assign(new EventEmitter(),{snapshot:()=>({running,starts}),start(){running=true;starts++;},async pause(){running=false;if(waiting){waiting=false;paused();await new Promise(resolve=>{release=resolve;});}},async stop(){running=false;}});}});
  try{
    await manager.execute('Alice','connect');await manager.execute('Blake','connect');await manager.execute('Alice','start');await manager.execute('Blake','start');
    waiting=true;t.mock.timers.tick(4000);await started;
    await manager.execute('Alice','pause');release();
    for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(manager.entries.get('Alice').brain.snapshot().running,false);assert.equal(manager.entries.get('Alice').brain.snapshot().starts,1);
    assert.equal(manager.entries.get('Blake').brain.snapshot().starts,2,'Unchanged teammate run intent may resume');
  }finally{release?.();await manager.close();t.mock.timers.reset();}
});
