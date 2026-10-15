import test from 'node:test';
import assert from 'node:assert/strict';
import { walkTarget,continuesWalk } from '../src/route-cursor.js';
import { safeCorridor,executeNavigate } from '../src/movement.js';
import { stepPhysics } from '../src/physics.js';
import { OMConnect } from '../index.js';

const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
const flat=p=>p.y<1?stone:air;
const walk=(x,z,y=1)=>({kind:'walk',position:{x,y,z}});
const state={position:{x:.5,y:1,z:.5},yaw:-90,pitch:0,onGround:true,health:20,food:20,velocity:{x:0,y:0,z:0}};
test('bounded lookahead can round a clear corner, but respects learned detours, edits and unknown footprints',()=>{
  const steps=[walk(1,0),walk(2,0),walk(2,1),walk(2,2)],corridor=(p,d,l)=>safeCorridor(p,d,l,flat);
  assert.equal(walkTarget(state,steps,0,corridor),3);
  assert.equal(walkTarget(state,steps,0,corridor,{shortcuts:false}),1);
  assert.equal(walkTarget(state,[steps[0],{kind:'dig',position:{x:2,y:1,z:0}},steps[1]],0,corridor),0);
  const hole=p=>p.x===1&&p.z===1?null:flat(p);
  assert.ok(walkTarget(state,steps,0,(p,d,l)=>safeCorridor(p,d,l,hole))<3);
  assert.equal(continuesWalk(state,[walk(16,0),walk(17,0)],0,corridor),true);
  assert.equal(continuesWalk(state,[walk(1,0),walk(2,0,2)],0,corridor),false);
});

test('a narrow unsupported corner requires braking before a turn',()=>{
  const ledge=p=>p.y<1&&(p.z===0&&p.x<=1||p.x===1&&p.z===1)?stone:air;
  assert.equal(continuesWalk(state,[walk(1,0),walk(1,1)],0,(p,d,l)=>safeCorridor(p,d,l,ledge)),false);
});

test('long walking spans preserve velocity across the lookahead boundary without server position acknowledgments',async()=>{
  const c=new OMConnect();Object.assign(c.state,structuredClone(state),{status:'ready'});
  c.world.blockAt=p=>flat({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
  c.client={state:'play',write(){},end(){}};
  let nearBoundary=0;const stopped=[];
  const timer=setInterval(()=>{c.state=stepPhysics(c.state,c.control,c.world.blockAt);c.tickLook();c.emit('physics');if(c.state.position.x>15.5&&c.state.position.x<17.5){nearBoundary++;if(Math.hypot(c.state.velocity.x,c.state.velocity.z)<.04)stopped.push({position:c.state.position,control:c.control,index:c.navigationDebug?.index});}},5);
  try {
    const result=await executeNavigate(c,{x:28,y:1,z:0,range:0,bridge:false,sprintJump:false},AbortSignal.timeout(5000));
    assert.equal(result.ok,true);assert.equal(c.metrics.corrections,0);assert.ok(nearBoundary>0);assert.deepEqual(stopped,[]);
    assert.ok(Math.abs(c.state.position.x-28.5)<.3);
  } finally {clearInterval(timer);await c.close();}
});

test('one server correction stops the old route and releases movement controls',async()=>{
  const c=new OMConnect();Object.assign(c.state,structuredClone(state),{status:'ready'});c.world.blockAt=flat;
  c.client={state:'play',write(){},end(){}};
  const correction=setTimeout(()=>{c.metrics.corrections++;},40);
  try {
    await assert.rejects(executeNavigate(c,{x:8,y:1,z:0,range:0,bridge:false},AbortSignal.timeout(2000)),e=>e.code==='SERVER_CORRECTION');
    assert.equal(c.control.x,0);assert.equal(c.control.sprint,false);
  } finally {clearTimeout(correction);await c.close();}
});
