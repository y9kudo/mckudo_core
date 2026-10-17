import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createAgentProgram,validateAgentProgram,createTaskQueue} from '../overmindmc.js';
import {tasksToProgram,programSource} from '../src/dashboard-public/program-builder.js';
const action=(id,ms=1)=>({id,type:'action',action:{skill:'wait',args:{durationMs:ms}}});
const document=nodes=>({schemaVersion:1,name:'Test program',nodes});
test('visual program executes branches, bounded repetitions and parallel goals only after actual results',()=>{
  const program=document([{id:'choice',type:'if',condition:{fact:'/self/health',lt:10},then:[action('low')],else:[action('healthy')]},{id:'repeat',type:'repeat',count:2,children:[action('twice',2)]},{id:'parallel',type:'parallel',children:[action('a',3),action('b',4)]}]);
  const c=createAgentProgram({program,skills:['wait']}),o={self:{health:20}},seen=[];
  for(let turn=0;turn<20&&c.snapshot().status!=='completed';turn++){
    const result=c.reactor.react(o);if(!result.action)continue;
    seen.push(result.action.args.durationMs);assert.notEqual(c.snapshot().status,'completed');c.recordResult({outcome:'success'},result.action);
  }
  assert.deepEqual(seen,[1,2,2,3,4]);assert.equal(c.snapshot().status,'completed');assert.equal(c.snapshot().nodes.find(n=>n.id==='choice').branch,'else');
  assert.equal(c.snapshot().nodes.find(n=>n.id==='twice').status,'completed');
});
test('until checks fresh observations, reports its limit, and cancelled actions remain pending',()=>{
  const program=document([{id:'until',type:'until',condition:{fact:'/inventory/minecraft:stone',gte:1},maxIterations:2,children:[action('wait')]}]);
  const c=createAgentProgram({program,skills:['wait']}),o={inventory:{'minecraft:stone':0}};
  let result=c.reactor.react(o);c.recordResult({outcome:'cancelled'},result.action);assert.equal(c.snapshot().nodes.find(n=>n.id==='wait').status,'pending');
  for(let i=0;i<8;i++){result=c.reactor.react(o);if(result.action)c.recordResult({outcome:'success'},result.action);}
  assert.equal(c.snapshot().status,'failed');assert.match(c.snapshot().reason,/Maximum iterations/);
  const done=createAgentProgram({program,skills:['wait']});assert.equal(done.reactor.react({inventory:{'minecraft:stone':1}}).action,null);assert.equal(done.snapshot().status,'completed');
});
test('program integrates with task execution and delegates resource scenarios to the kernel',()=>{
  const program=document([{id:'supply',type:'resources',targets:{'#logs':4}},action('after')]);let collected=0;
  const queue=createTaskQueue({tasks:[{id:'program',title:'Program',type:'program',program}],skills:['wait'],scenarioFactory:scenario=>{
    assert.equal(scenario.steps[0].targets['#logs'],4);
    return {reactor:{react:()=>collected?{action:null}:{action:{skill:'wait',args:{durationMs:5}}}},recordResult(){collected++;},snapshot:()=>({status:collected?'completed':'running'})};
  }}),brain=new EventEmitter();queue.attach(brain);
  const first=queue.reactor.react({});brain.emit('action:start',{id:queue.reactor.id,action:first.action});brain.emit('action:finish',{rule:'defense',outcome:'success'});assert.equal(collected,0);
  brain.emit('action:finish',{rule:queue.reactor.id,outcome:'success'});assert.equal(collected,1);
  const second=queue.reactor.react({});assert.equal(second.action.args.durationMs,1);brain.emit('action:start',{id:queue.reactor.id,action:second.action});brain.emit('action:finish',{rule:queue.reactor.id,outcome:'success'});queue.reactor.react({});assert.equal(queue.snapshot()[0].status,'completed');
  assert.equal(queue.snapshot()[0].program.status,'completed');
});
test('program validation rejects unbounded loops, unknown skills, duplicate IDs and executable strings',()=>{
  assert.throws(()=>validateAgentProgram(document([{id:'loop',type:'until',condition:{fact:'/self/health',gt:0},children:[]}]),{skills:['wait']}),/maxIterations/);
  assert.throws(()=>validateAgentProgram(document([action('a'),action('a')]),{skills:['wait']}),/unique/);
  assert.throws(()=>validateAgentProgram(document([action('a')]),{skills:[]}),/available skill/);
  assert.throws(()=>validateAgentProgram({...document([]),code:'process.exit()'}),/requires/);
  assert.throws(()=>validateAgentProgram(document(Array.from({length:65},(_,i)=>action('a'+i))),{skills:['wait']}),/64 nodes/);
});

test('program resumes a bounded loop without replaying completed actions and reports child failure',()=>{
  const program=document([action('first'),{id:'repeat',type:'repeat',count:2,children:[action('inside')]}]),skills=['wait'];
  const c=createAgentProgram({program,skills});let d=c.reactor.react({});c.recordResult({outcome:'success'},d.action);
  d=c.reactor.react({});c.recordResult({outcome:'success'},d.action);c.reactor.react({});
  const saved=c.snapshot();assert.equal(saved.nodes.find(n=>n.id==='repeat').iteration,1);
  const resumed=createAgentProgram({program,skills,resume:saved});d=resumed.reactor.react({});assert.equal(resumed.snapshot().active,'inside');resumed.recordResult({outcome:'success'},d.action);
  for(let i=0;i<3;i++)assert.equal(resumed.reactor.react({}).action,null);
  assert.equal(resumed.snapshot().status,'completed');
  const failed=createAgentProgram({program:document([action('fail')]),skills});
  for(let i=0;i<3;i++){d=failed.reactor.react({});failed.recordResult({outcome:'failure',detail:'No path'},d.action);}
  assert.equal(failed.snapshot().status,'failed');assert.equal(failed.reactor.react({}).action,null);
});

test('visual imports preserve mixed program queues, independent goals and unique nested IDs',()=>{
  const child=document([action('wait')]);
  const tasks=[{id:'first',title:'First',type:'program',program:child},{id:'second',title:'Second',type:'program',program:child,mode:'parallel'},{id:'last',title:'Last',type:'action',action:action('unused').action}];
  const result=validateAgentProgram(tasksToProgram(tasks),{skills:['wait']});
  assert.equal(result.nodes[0].type,'parallel');assert.equal(result.nodes[0].children[0].type,'sequence');
  assert.match(programSource(result),/await agent.runProgram/);
  const controller=createAgentProgram({program:result,skills:['wait']});let completed=0;
  for(let i=0;i<12&&controller.snapshot().status!=='completed';i++){const d=controller.reactor.react({});if(d.action){completed++;controller.recordResult({outcome:'success'},d.action);}}
  assert.equal(completed,3);assert.equal(controller.snapshot().status,'completed');
});

test('eight control-flow levels survive validation, task wrapping and public definition copies',()=>{
  let node=action('deep');for(let i=0;i<8;i++)node={id:'group-'+i,type:'sequence',children:[node]};
  const program=document([node]),skills=['wait'];const controller=createAgentProgram({program,skills});assert.deepEqual(controller.definition(),program);
  const tasks=[{id:'nested',title:'Nested',type:'program',program}],queue=createTaskQueue({tasks,skills});assert.deepEqual(queue.definition(),tasks);assert.equal(queue.reactor.react({}).action.skill,'wait');
  assert.throws(()=>validateAgentProgram(document([{id:'too-deep',type:'sequence',children:[node]}]),{skills}),/8 levels/);
});

test('dependency queues cannot silently lose their guards when opened by the visual editor',()=>{
  assert.throws(()=>tasksToProgram([{id:'guarded',title:'Guarded',type:'action',dependsOn:[],requires:{fact:'/tool',eq:true},action:{skill:'wait',args:{}}}]),/JSON mode/);
});
