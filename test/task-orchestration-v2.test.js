import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createCore, createMinecraftAgent, createTaskQueue, validateTasks, createAgentProgram, createAgentMemory, createAgentManager} from '../overmindmc.js';
import {createMissionRecovery} from '../src/mission-recovery.js';
import {OMConnect} from '../omconnect/index.js';

const action = (id, skill='wait', extra={}) => ({id,title:id,type:'action',action:{skill,args:{}},...extra});
const complete = (q, brain, o={}) => {
  const d=q.reactor.react(o);assert.ok(d.action);
  brain.emit('action:start',{id:q.reactor.id,action:d.action});brain.emit('action:finish',{rule:q.reactor.id,outcome:'success'});
  return d;
};
const fixture = async t => {
  const parent=resolve(tmpdir()), directory=await mkdtemp(join(parent,'overmind-v2-'));
  t.after(async()=>{assert.ok(resolve(directory).startsWith(parent+ (process.platform==='win32'?'\\':'/')));await rm(directory,{recursive:true,force:true});});
  return directory;
};
const memoryFile = (root,world='test',name='Atlas') => join(root,createHash('sha256').update(world).digest('hex').slice(0,24),name+'.json');

test('DAG validates explicit and implicit cycles, and dependencies override priority',()=>{
  const tasks=[action('a','wait',{mode:'parallel',dependsOn:['b'],priority:100}),action('b','wait',{mode:'parallel'})],q=createTaskQueue({tasks,skills:['wait']}),brain=new EventEmitter();q.attach(brain);
  assert.equal(complete(q,brain).reason,'b');assert.equal(complete(q,brain).reason,'a');
  assert.throws(()=>validateTasks([action('a','wait',{dependsOn:['b']}),action('b')],{skills:['wait']}),/cycle/);
  assert.throws(()=>validateTasks([action('a','wait',{dependsOn:['missing']})],{skills:['wait']}),/dependency/);
  assert.throws(()=>validateTasks([action('a','wait',{dependsOn:['a']})],{skills:['wait']}),/dependency/);
});

test('unknown resource conditions block, dynamic priorities use fresh facts, failed dependencies explain the block',()=>{
  const q=createTaskQueue({tasks:[action('low','wait',{mode:'parallel',requires:{not:{fact:'/tool',eq:false}},priorityWhen:[{condition:{fact:'/urgent',eq:true},boost:50}]}),action('normal','wait',{mode:'parallel',priority:10})],skills:['wait']});
  assert.equal(q.reactor.react({}).reason,'normal');assert.match(q.snapshot()[0].reason,/Required/);
  assert.equal(q.reactor.react({tool:true,urgent:true}).reason,'low');
  const blocked=createTaskQueue({tasks:[action('first'),action('after','wait',{mode:'parallel',dependsOn:['first']})],skills:['wait'],resume:[{id:'first',status:'failed',reason:'No path'}]});
  assert.equal(blocked.reactor.react({}).action,null);assert.match(blocked.snapshot()[1].reason,/first/);
});

test('checkpoints reject edited definitions and preserve bounded backoff and completion across restart',()=>{
  let now=100;const tasks=[action('first'),action('retry','wait',{retry:{maxAttempts:2,delayMs:200}})],q=createTaskQueue({tasks,skills:['wait'],clock:()=>now}),brain=new EventEmitter();q.attach(brain);complete(q,brain);
  let d=q.reactor.react({});brain.emit('action:start',{id:q.reactor.id,action:d.action});brain.emit('action:finish',{rule:q.reactor.id,outcome:'failure'});
  const checkpoint=q.checkpoint(),restored=createTaskQueue({tasks,skills:['wait'],resume:checkpoint,clock:()=>now}),events=new EventEmitter();restored.attach(events);
  assert.equal(restored.reactor.react({}).action,null);now=301;
  d=restored.reactor.react({});events.emit('action:start',{id:restored.reactor.id,action:d.action});events.emit('action:finish',{rule:restored.reactor.id,outcome:'failure'});
  assert.equal(restored.snapshot()[0].status,'completed');assert.equal(restored.snapshot()[1].status,'failed');
  assert.throws(()=>createTaskQueue({tasks:[...tasks,action('changed')],skills:['wait'],resume:checkpoint}),/definition/);
});

test('an uncertain transfer never replays automatically, but observed postconditions reconcile it',()=>{
  const tasks=[action('gift','toss',{expected:{fact:'/inventory/minecraft:stone',eq:0}})],q=createTaskQueue({tasks,skills:['toss']}),brain=new EventEmitter();q.attach(brain);
  const d=q.reactor.react({inventory:{'minecraft:stone':1}});brain.emit('action:start',{id:q.reactor.id,action:d.action});
  const restored=createTaskQueue({tasks,skills:['toss'],resume:q.checkpoint()});
  assert.equal(restored.reactor.react({inventory:{'minecraft:stone':1}}).action,null);assert.match(restored.snapshot()[0].reason,/unknown outcome/);
  assert.equal(restored.reactor.react({inventory:{'minecraft:stone':0}}).action,null);assert.equal(restored.snapshot()[0].status,'completed');
  assert.equal(q.snapshot()[0].status,'running');
});

test('program checkpoints preserve completed nodes, active mutation uncertainty and scenario memory',()=>{
  const program={schemaVersion:1,name:'Transfer',nodes:[{id:'gift',type:'action',action:{skill:'toss',args:{}}}]};
  const c=createAgentProgram({program,skills:['toss']});c.reactor.react({});c.beginAction();
  const resumed=createAgentProgram({program,skills:['toss'],resume:c.snapshot()});assert.equal(resumed.reactor.react({}).action,null);assert.match(resumed.snapshot().reason,/unknown outcome/);
  assert.throws(()=>createAgentProgram({program:{...program,name:'Changed'},skills:['toss'],resume:c.snapshot()}),/definition/);
  const scenario={schemaVersion:1,name:'Supplies',steps:[{id:'logs',type:'resources',targets:{'#logs':1}}]};
  let passed;
  const q=createTaskQueue({tasks:[{id:'supplies',title:'Supplies',type:'scenario',scenario}],scenarioFactory:(_s,memory)=>{passed=memory;return {reactor:{react:()=>({action:null,reason:'Waiting'})},snapshot:()=>({status:'running'}),exportMemory:()=>({checkpoint:42})};}});
  q.reactor.react({});const q2=createTaskQueue({tasks:q.definition(),resume:q.checkpoint(),scenarioFactory:(_s,m)=>{passed=m;return {reactor:{react:()=>({action:null})},snapshot:()=>({status:'running'})};}});q2.reactor.react({});assert.deepEqual(passed,{checkpoint:42});
});

test('physical dispatch waits for a durable running checkpoint and final completion is saved',async()=>{
  let release;const barrier=new Promise(r=>{release=r;}),saved=[],events=[];
  const q=createTaskQueue({tasks:[action('work')],skills:['wait'],checkpoint:async s=>{saved.push(s);if(saved.length===1){events.push('prepared');await barrier;}}});
  const core=createCore({config:{schemaVersion:4,name:'Durable',worldId:'test',rules:[]},adapter:{describe:()=>({protocolVersion:1,kind:'test',skills:['wait']}),observe:async()=>({}),execute:async()=>{events.push('executed');return {ok:true};}},reactors:[q.reactor]});q.attach(core);
  const pending=core.tick();await delay(10);assert.deepEqual(events,['prepared']);assert.equal(saved[0].tasks[0].status,'running');
  release();await pending;assert.deepEqual(events,['prepared','executed']);assert.equal(saved.at(-1).tasks[0].status,'completed');await core.stop();
});

test('a failed durable write prevents dispatch and cannot spin into more actions',async()=>{
  let calls=0;const q=createTaskQueue({tasks:[action('work')],skills:['wait'],checkpoint:async()=>{throw new Error('Disk unavailable');}});
  const core=createCore({config:{schemaVersion:4,name:'Durable',worldId:'test',rules:[]},adapter:{describe:()=>({protocolVersion:1,kind:'test',skills:['wait']}),observe:async()=>({}),execute:async()=>{calls++;}},reactors:[q.reactor]});q.attach(core);
  const training=[];core.on('experience:transition',sample=>training.push(sample));await core.tick();await core.tick();assert.equal(training.length,0);assert.equal(calls,0);assert.match(q.reactor.react({}).reason,/Checkpoint failed/);await core.stop();
});

test('task timeouts cancel cooperatively, settle before retry, and preserve one executor',async()=>{
  let active=0,peak=0;const q=createTaskQueue({tasks:[action('slow','wait',{timeoutMs:100,retry:{maxAttempts:2}})],skills:['wait']});
  const core=createCore({config:{schemaVersion:4,name:'Timeout',worldId:'test',rules:[]},adapter:{describe:()=>({protocolVersion:1,kind:'test',skills:['wait']}),observe:async()=>({}),execute:async(_a,{signal})=>{active++;peak=Math.max(peak,active);try{await delay(1000,undefined,{signal});}finally{active--;}}},reactors:[q.reactor]});q.attach(core);
  await core.tick();assert.equal(q.snapshot()[0].failures,1);assert.equal(active,0);await core.tick();assert.equal(q.snapshot()[0].status,'failed');assert.equal(peak,1);await core.stop();
});

test('checksummed storage recovers previous generation and leaves damaged primary intact until a new commit',async t=>{
  const directory=await fixture(t),m=createAgentMemory(directory,'test');await m.save('Atlas',{goal:'wood'});await m.save('Atlas',{goal:'stone_tools'});
  const file=memoryFile(directory),raw=JSON.parse(await readFile(file,'utf8'));raw.payload.goal='diamond_set';await writeFile(file,JSON.stringify(raw));const damaged=await readFile(file,'utf8');
  assert.equal((await m.load('Atlas')).goal,'wood');assert.equal(m.diagnostics('Atlas').recovered,true);assert.equal(await readFile(file,'utf8'),damaged);
  await m.save('Atlas',{goal:'iron_pickaxe'});assert.equal((await m.load('Atlas')).goal,'iron_pickaxe');assert.ok(!(await readdir(resolve(file,'..'))).some(n=>n.endsWith('.tmp')));
});

test('legacy beta1 files migrate on save and invalid identity cannot be silently overwritten',async t=>{
  const directory=await fixture(t),m=createAgentMemory(directory,'test');await m.save('Atlas',{});
  const file=memoryFile(directory);await writeFile(file,JSON.stringify({schemaVersion:1,worldId:'test',name:'Atlas',goal:'wood'}));
  assert.equal((await m.load('Atlas')).goal,'wood');assert.equal(m.diagnostics('Atlas').legacy,true);
  await m.save('Atlas',{goal:'stone_tools'});assert.equal(JSON.parse(await readFile(file,'utf8')).format,'overmind:transactional-json');
  const other=createAgentMemory(directory,'test');await other.save('Blake',{});
  const otherFile=memoryFile(directory,'test','Blake');await writeFile(otherFile,JSON.stringify({schemaVersion:1,worldId:'wrong',name:'Blake'}));
  await assert.rejects(other.load('Blake'),/No valid memory/);await assert.rejects(other.save('Blake',{}),/No valid memory/);
});

test('independent stores serialize same-path commits and capture payloads at the call boundary',async t=>{
  const directory=await fixture(t),a=createAgentMemory(directory,'test'),b=createAgentMemory(directory,'test'),payload={goal:'wood'};
  const first=a.save('Atlas',payload);payload.goal='diamond_set';const second=b.save('Atlas',{goal:'stone_tools'});await Promise.all([first,second]);
  assert.equal((await a.load('Atlas')).goal,'stone_tools');assert.equal(a.diagnostics('Atlas').revision,2);
  const backup=JSON.parse(await readFile(memoryFile(directory)+'.bak','utf8'));assert.equal(backup.payload.goal,'wood');
});

test('recovery deduplicates events, bounds retries and death budget, and close cancels backoff',async()=>{
  let calls=0;const recovery=createMissionRecovery({maxAttempts:3,baseDelayMs:0,maxDeaths:1,recover:async()=>{if(++calls<2)throw new Error('Not ready');}});
  recovery.enable();const pending=recovery.request('death');assert.equal(recovery.request('disconnected'),pending);await pending;
  assert.equal(calls,2);assert.equal(recovery.snapshot().phase,'working');await recovery.request('death');assert.equal(recovery.snapshot().phase,'blocked');await recovery.close();
  const paused=createMissionRecovery({baseDelayMs:1000,recover:async()=>{throw new Error('Must not run');}});paused.enable();const p=paused.request('disconnected');paused.pause();await p;assert.equal(paused.snapshot().phase,'paused');await paused.close();
  const bounded=createMissionRecovery({baseDelayMs:0,maxAttempts:2,recover:async()=>{throw new Error('Still unavailable');}});bounded.enable();await bounded.request('disconnected');assert.equal(bounded.snapshot().attempts,2);assert.equal(bounded.snapshot().phase,'blocked');await bounded.close();
});

test('manager reconnects once after a dropped connection and explicit disconnect disables recovery',async()=>{
  let connects=0,starts=0;const manager=createAgentManager({names:['Atlas'],count:1,recovery:{baseDelayMs:0,maxAttempts:2},createClient:options=>{
    const c=new OMConnect(options);c.connect=async()=>{connects++;c.connectedOnce=true;c.state.status='ready';c.state.health=20;};c.close=async()=>{c.state.status='disconnected';c.emit('end');};return c;
  },createBrain:()=>Object.assign(new EventEmitter(),{snapshot:()=>({}),stop:async()=>{},start:()=>{starts++;}})});
  try{
    await manager.execute('Atlas','connect');await manager.execute('Atlas','start');const old=manager.entries.get('Atlas').client;old.state.status='disconnected';old.emit('end');
    for(let i=0;i<50&&starts<2;i++)await delay(10);
    assert.equal(connects,2);assert.equal(starts,2);await manager.execute('Atlas','disconnect');await delay(20);assert.equal(connects,2);assert.equal(manager.snapshot().agents[0].recovery.phase,'paused');
  }finally{await manager.close();}
});

test('task checkpoints have an independent namespace and do not rewrite learned/world memory',async t=>{
  const directory=await fixture(t),memory=createAgentMemory(directory,'test');
  await memory.save('Atlas',{goal:'wood'});const main=await readFile(memoryFile(directory),'utf8');
  const tasks=[action('work')],queue=createTaskQueue({tasks,skills:['wait']});
  await memory.saveTasks('Atlas',{tasks,taskCheckpoint:queue.checkpoint()});assert.deepEqual((await memory.loadTasks('Atlas')).tasks,tasks);
  assert.equal(await readFile(memoryFile(directory),'utf8'),main);assert.equal((await memory.load('Atlas')).goal,'wood');
});

test('nested scenario checkpoints survive visual-program restoration without resetting their controller',()=>{
  const program={schemaVersion:1,name:'Supplies',nodes:[{id:'supply',type:'resources',targets:{'#logs':1}}]};
  const factory=(_scenario,memory)=>({reactor:{react:()=>({action:null,reason:'Waiting'})},snapshot:()=>({status:'running'}),exportMemory:()=>memory||{checkpoint:123}});
  const original=createAgentProgram({program,scenarioFactory:factory});original.reactor.react({});
  let restored;
  const next=createAgentProgram({program,resume:original.snapshot(),scenarioFactory:(s,m)=>{restored=m;return factory(s,m);}});next.reactor.react({});
  assert.deepEqual(restored,{checkpoint:123});
});

test('completion persistence failure reports the successful world action once and blocks further dispatch',async()=>{
  let writes=0,dispatch=0;const q=createTaskQueue({tasks:[action('one'),action('two')],skills:['wait'],checkpoint:async()=>{if(++writes===2)throw new Error('Disk failed after execution');}});
  const core=createCore({config:{schemaVersion:4,name:'Complete',worldId:'test'},adapter:{describe:()=>({protocolVersion:1,kind:'test',skills:['wait']}),observe:async()=>({}),execute:async()=>{dispatch++;}},reactors:[q.reactor]}),results=[];q.attach(core);core.on('action:finish',r=>results.push(r));
  await core.tick();assert.equal(results.length,1);assert.equal(results[0].outcome,'success');assert.equal(core.snapshot().status,'fault');await core.tick();assert.equal(dispatch,1);await core.stop();
});

test('a task checkpoint is authoritative after a crash between mission and model commits',async t=>{
  const directory=await fixture(t),storage=createAgentMemory(directory,'test');
  const old=[action('old')],current=[action('new')],queue=createTaskQueue({tasks:current,skills:['wait']}),events=new EventEmitter();queue.attach(events);complete(queue,events);
  await storage.save('Atlas',{tasks:old});await storage.saveTasks('Atlas',{tasks:current,taskCheckpoint:queue.checkpoint(),taskState:queue.snapshot()});
  const manager=createAgentManager({count:1,names:['Atlas'],worldId:'test',memoryDirectory:directory});
  try{await manager.ready;assert.equal(manager.snapshot().agents[0].tasks[0].id,'new');assert.equal(manager.snapshot().agents[0].taskState[0].status,'completed');}finally{await manager.close();}
});

test('unknown outcomes in completed programs cannot be mistaken for completed action nodes',()=>{
  const p={schemaVersion:1,name:'Interrupted',nodes:[{id:'a',type:'action',action:{skill:'toss',args:{}}}]};
  const c=createAgentProgram({program:p,skills:['toss']});const d=c.reactor.react({});c.beginAction();c.recordResult({outcome:'cancelled'},d.action);
  assert.equal(c.reactor.react({}).action,null);assert.notEqual(c.snapshot().status,'completed');assert.equal(c.snapshot().nodes[0].uncertain,true);
});

test('the simple agent facade waits through opt-in recovery without replacing its saved program',async()=>{
  let starts=0,connects=0,agent;
  agent=createMinecraftAgent({name:'Atlas',worldId:'facade-recovery',recovery:{baseDelayMs:0,maxAttempts:2},createClient:options=>{
    const c=new OMConnect(options);c.connect=async()=>{connects++;c.connectedOnce=true;c.state.status='ready';c.state.health=20;};c.close=async()=>{c.state.status='disconnected';c.emit('end');};return c;
  },createBrain:options=>{
    const brain=Object.assign(new EventEmitter(),{snapshot:()=>({}),stop:async()=>{},pause:async()=>{},start(){
      if(++starts===1){agent.client.state.status='disconnected';agent.client.emit('end');return;}
      const reactor=options.reactors[0],decision=reactor.react({});brain.emit('action:start',{id:reactor.id,action:decision.action});brain.emit('action:finish',{rule:reactor.id,outcome:'success'});reactor.react({});
    }});return brain;
  }});
  try{
    const result=await agent.runProgram({schemaVersion:1,name:'Resume',nodes:[{id:'wait',type:'action',action:{skill:'wait',args:{}}}]},{timeoutMs:3000});
    assert.equal(result.taskState[0].status,'completed');assert.equal(connects,2);assert.equal(starts,2);
  }finally{await agent.close();}
});
