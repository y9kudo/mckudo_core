import test from 'node:test';
import assert from 'node:assert/strict';
import {createTickLoop} from '../src/timing.js';

function simulation(){
  let now=0,sequence=0;const timers=new Map();
  return {clock:()=>now,schedule:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,due:now+ms});return id;},cancel:id=>timers.delete(id),
    fire(late=0){const [id,t]=[...timers][0];timers.delete(id);now=t.due+late;t.fn();},set:time=>{now=time;},pending:()=>timers.size};
}
test('timer lateness does not accumulate into slower simulation',()=>{
  const s=simulation(),ticks=[],loop=createTickLoop(()=>ticks.push(s.clock()),s);
  for(let i=0;i<5;i++)s.fire(13);
  assert.deepEqual(ticks,[63,113,163,213,263]);loop.stop();assert.equal(s.pending(),0);
});
test('a long pause yields one tick and no packet catch-up burst',()=>{
  const s=simulation();let ticks=0;const loop=createTickLoop(()=>ticks++,s);
  s.fire(950);assert.equal(ticks,1);s.fire();assert.equal(ticks,2);assert.equal(s.clock(),1050);loop.stop();
});
test('stopping inside the callback cancels future physics callbacks',()=>{
  const s=simulation();let loop,ticks=0;loop=createTickLoop(()=>{ticks++;loop.stop();},s);s.fire();assert.equal(ticks,1);assert.equal(s.pending(),0);
});
