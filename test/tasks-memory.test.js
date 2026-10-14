import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskQueue,validateTasks} from '../src/task-queue.js';
import {createAgentMemory} from '../src/agent-memory.js';
import {createNeuralNavigator} from '../src/neural-navigation.js';
import {createAgentManager} from '../src/agent-manager.js';
import {createSpatialMemory} from '../src/spatial-memory.js';
import {OMConnect} from '../omconnect/index.js';
const tasks=[{id:'one',title:'Wait',type:'action',action:{skill:'wait',args:{durationMs:1}}},{id:'two',title:'Wait again',type:'action',action:{skill:'wait',args:{durationMs:2}}}];
test('task queue attributes result to started task, ignores unrelated actions and persists completion',()=>{
  const q=createTaskQueue({tasks,skills:['wait']}),brain=new EventEmitter();q.attach(brain);
  const d=q.reactor.react({});brain.emit('action:start',{id:q.reactor.id,action:d.action});
  q.reactor.react({});brain.emit('action:finish',{rule:'defense',outcome:'success'});assert.notEqual(q.snapshot()[0].status,'completed');
  brain.emit('action:finish',{rule:q.reactor.id,outcome:'success'});assert.equal(q.snapshot()[0].status,'completed');
  const next=q.reactor.react({});brain.emit('action:start',{id:q.reactor.id,action:next.action});brain.emit('action:finish',{rule:q.reactor.id,outcome:'failure',detail:'blocked'});
  assert.equal(q.reactor.react({}).action,null);q.retry('two');assert.equal(q.reactor.react({}).action.args.durationMs,2);
  assert.equal(createTaskQueue({tasks,skills:['wait'],resume:q.snapshot()}).reactor.react({}).action.args.durationMs,2);
  assert.throws(()=>validateTasks([null],{skills:['wait']}));assert.throws(()=>validateTasks([tasks[0],tasks[0]],{skills:['wait']}),/unique/);
});
test('scenario retries are bounded and a successful alternative resets the failure streak',()=>{
  let attempts=0,recorded=0;
  const task={id:'scenario',title:'Resources',type:'scenario',scenario:{schemaVersion:1,name:'Resources',steps:[{id:'logs',type:'resources',targets:{'#logs':1}}]}};
  const q=createTaskQueue({tasks:[task],scenarioFactory:()=>({reactor:{react:()=>({action:{skill:'navigate',args:{x:++attempts,y:1,z:0}},reason:'Try another path'})},snapshot:()=>({status:'running'}),recordResult(){recorded++;}})});
  const brain=new EventEmitter();q.attach(brain);
  const finish=outcome=>{const d=q.reactor.react({});assert.ok(d.action);brain.emit('action:start',{id:q.reactor.id,action:d.action});assert.equal(q.reactor.react({}).action,null);brain.emit('action:finish',{rule:q.reactor.id,outcome});};
  for(let i=0;i<5;i++)finish('failure');
  finish('success');for(let i=0;i<5;i++)finish('failure');
  assert.equal(q.snapshot()[0].status,'blocked');finish('failure');
  assert.equal(q.snapshot()[0].status,'failed');assert.equal(q.reactor.react({}).action,null);assert.equal(recorded,12);
  q.retry('scenario');finish('failure');assert.equal(q.snapshot()[0].status,'blocked');
});
test('atomic agent memory reloads trained weights and separates worlds and agents',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mckudo-memory-'));
  try{
    const memory=createAgentMemory(directory,'a'),model=createNeuralNavigator({worldId:'a'});model.record({dimension:'minecraft:overworld',from:{x:0,y:1,z:0},to:{x:1,y:1,z:0},outcome:'failure'});
    await memory.save('Atlas',{neural:model.export(),tasks});const state=await memory.load('Atlas');assert.equal(createNeuralNavigator({worldId:'a',memory:state.neural}).snapshot().samples,1);
    assert.equal(await createAgentMemory(directory,'b').load('Atlas'),null);assert.equal(await memory.load('Blake'),null);await assert.rejects(memory.load('../Atlas'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('manager rejects invalid edits without discarding the saved queue and restores it',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mckudo-manager-'));let m=createAgentManager({count:1,names:['Atlas'],memoryDirectory:directory,worldId:'test'});
  try{await m.execute('Atlas','tasks',{tasks});await assert.rejects(m.execute('Atlas','tasks',{tasks:[{...tasks[0],action:{skill:'nonexistent',args:{}}}]}));assert.equal(m.snapshot().agents[0].tasks.length,2);assert.equal(m.entries.get('Atlas').client.dataLoaded,false);await m.close();m=createAgentManager({count:1,names:['Atlas'],memoryDirectory:directory,worldId:'test'});await m.ready;assert.equal(m.snapshot().agents[0].tasks.length,2);}finally{await m.close();await rm(directory,{recursive:true,force:true});}
});

test('manager restores spatial memory into the brain and persists later observations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mckudo-atlas-')), storage=createAgentMemory(directory,'atlas-world');
  const atlas=createSpatialMemory({worldId:'atlas-world'}), observed=x=>({dimension:'minecraft:overworld',world:{sampledBlocks:[{name:'minecraft:birch_log',position:{x,y:64,z:0}}]}});
  atlas.observe(observed(2)); await storage.save('Atlas',{spatial:atlas.export()});
  const manager=createAgentManager({count:1,names:['Atlas'],worldId:'atlas-world',memoryDirectory:directory,
    createClient:options=>{const c=new OMConnect(options);c.state.status='ready';return c;},
    createBrain:options=>({spatial:createSpatialMemory({worldId:options.worldId,memory:options.spatial.memory}),start(){},async stop(){},snapshot:()=>({})})});
  try {
    await manager.execute('Atlas','start');
    const memory=manager.entries.get('Atlas').brain.spatial; assert.equal(memory.entries()[0].position.x,2);
    memory.observe(observed(3)); await manager.close();
    assert.equal(createSpatialMemory({worldId:'atlas-world',memory:(await storage.load('Atlas')).spatial}).entries().length,2);
  }finally{await manager.close();assert.ok(directory.startsWith(join(tmpdir(),'mckudo-atlas-')));await rm(directory,{recursive:true,force:true});}
});
