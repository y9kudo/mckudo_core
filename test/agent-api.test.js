import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMinecraftAgent } from '../mckudo_core.js';
import { KudoConnect } from '../kudoconnect/index.js';

const scenario = {schemaVersion:1,name:'Wood',steps:[{id:'wood',type:'resources',targets:{'#logs':1}}]};
function fixture({complete=false,die=false}={}) {
  let connects=0,stops=0,closes=0;
  const agent=createMinecraftAgent({name:'Atlas',worldId:'api-test',brainOptions:{storage:false,neural:false},
    createClient:options=>{const c=new KudoConnect(options);c.connect=async()=>{connects++;c.connectedOnce=true;c.state.status='ready';c.state.health=20;};c.close=async()=>{closes++;c.state.status='disconnected';};return c;},
    createBrain:options=>{
      assert.equal(options.storage,false);assert.equal(options.neural,false);
      const b=new EventEmitter();Object.assign(b,{snapshot:()=>({running:false}),async pause(){stops++;},async stop(){stops++;},start(){
        if(die){agent.client.state.status='dead';return;}
        if(complete)options.reactors[0].react({inventory:{'minecraft:birch_log':1},equipment:{},self:{position:{x:0,y:64,z:0}},dimension:'minecraft:overworld'});
      }});return b;
    }});
  return {agent,counts:()=>({connects,stops,closes})};
}
test('simple agent rejects invalid scenarios before connecting and confirms class-based completion',async()=>{
  const {agent,counts}=fixture({complete:true});
  try {
    assert.throws(()=>agent.run({...scenario,steps:[]}),/Сценарий/);assert.equal(counts().connects,0);
    const result=await agent.run(scenario);assert.equal(result.taskState[0].status,'completed');assert.equal(counts().connects,1);assert.ok(counts().stops);
    await agent.close();await agent.close();assert.equal(counts().closes,1);await assert.rejects(agent.connect(),/закрыт/);
  }finally{await agent.close();}
});

test('beginner methods validate before opening a connection and use the normal scenario queue',async()=>{
  const {agent,counts}=fixture({complete:true});
  try{
    assert.throws(()=>agent.get('#logs',0),/count/);assert.throws(()=>agent.goTo({x:1.2,y:64,z:0}),/координаты/);assert.equal(counts().connects,0);
    const result=await agent.get('#logs',1);assert.equal(result.taskState[0].status,'completed');
    const mission=agent.snapshot().tasks[0].scenario;assert.deepEqual(mission.steps[0].targets,{'#logs':1});
  }finally{await agent.close();}
});
test('run cancellation stops the action, frees the run lock and close is idempotent',async()=>{
  const {agent}=fixture();const controller=new AbortController();
  try {
    const first=agent.run(scenario,{signal:controller.signal});const checked=assert.rejects(first,/abort|cancel|отмен/i);
    assert.throws(()=>agent.run(scenario),/Один агент/);
    controller.abort(new Error('cancel requested'));await checked;
    const second=agent.run(scenario);const stopped=assert.rejects(second,/abort|остановлен/i);await agent.pause();await stopped;
    const third=agent.run(scenario);const closed=assert.rejects(third,/закры|abort/i);await agent.close();await closed;
  }finally{await agent.close();}
});
test('death is an incomplete scenario, not a success',async()=>{
  const {agent}=fixture({die:true});try{await assert.rejects(agent.run(scenario),/погиб/);assert.notEqual(agent.snapshot().taskState[0].status,'completed');}finally{await agent.close();}
});

test('cancelling an unfinished connection closes the socket and preserves the cancellation reason',async()=>{
  let entered,release,closed=0;const started=new Promise(resolve=>{entered=resolve;});
  const agent=createMinecraftAgent({worldId:'connecting-test',createClient:options=>{
    const c=new KudoConnect(options);
    c.connect=async()=>{c.state.status='connecting';entered();await new Promise(resolve=>{release=resolve;});};
    c.close=async()=>{closed++;c.state.status='disconnected';release?.();};return c;
  }});
  const controller=new AbortController();
  try {
    const run=agent.run(scenario,{signal:controller.signal});const checked=assert.rejects(run,/cancel handshake/);
    await started;controller.abort(new Error('cancel handshake'));await checked;assert.ok(closed>=1);
  }finally{await agent.close();}
});
