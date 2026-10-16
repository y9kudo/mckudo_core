import test from 'node:test';
import assert from 'node:assert/strict';
import {runAction} from '../src/actions.js';
import {OMConnect,stepPhysics} from '../index.js';
import {planRetreatExcavation} from '../src/retreat.js';

const air={name:'air',boundingBox:'empty',shapes:[]};
const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};

test('evade takes a safe local step when a narrow passage has no full retreat route',async()=>{
  const controls=[];
  const c={state:{status:'ready',health:5,food:12,onGround:true,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}},
    entities:new Map(),world:{revision:0,blockAt:p=>p.y<1&&p.x>=0&&p.x<=2&&p.z===0?stone:air},
    set control(value){controls.push(value);},stopMovement(){controls.push({x:0,z:0,jump:false,sprint:false});}};
  const result=await runAction(c,{skill:'evade',args:{from:{x:-2,y:1,z:.5}}},new AbortController().signal);
  assert.equal(result.emergencyStep,true);
  assert.ok(controls.some(v=>v.x>0&&!v.sprint));
  assert.equal(controls.at(-1).x,0);
});
test('close creeper triggers immediate sprint rather than waiting for A*',async()=>{
  const controls=[];
  const c={state:{status:'ready',health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}},
    entities:new Map([[7,{id:'7',name:'creeper',position:{x:-2,y:1,z:.5}}]]),world:{revision:0,blockAt:p=>p.y<1?stone:air},
    set control(value){controls.push(value);},stopMovement(){controls.push({x:0,z:0,jump:false,sprint:false});}};
  const result=await runAction(c,{skill:'evade',args:{from:{x:-2,y:1,z:.5},entityId:'7'}},new AbortController().signal);
  assert.equal(result.emergencyStep,true);
  assert.ok(controls.some(v=>v.x>0&&v.sprint));
});
test('retreat can climb a one-block exit when every same-height destination is blocked',async()=>{
  const c=new OMConnect();Object.assign(c.state,{status:'ready',health:20,food:20,onGround:true,yaw:-90,pitch:0,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}});
  c.client={state:'play',write(){},end(){}};
  c.world.blockAt=p=>Math.floor(p.z)!==0||p.y<1||p.x>=1&&p.y<2?stone:air;
  c.entities.set(7,{id:7,name:'skeleton',position:{x:-6,y:1,z:.5}});
  const timer=setInterval(()=>{c.state=stepPhysics(c.state,c.control,c.world.blockAt);c.tickLook();c.emit('physics');},50);
  try{
    const result=await runAction(c,{skill:'evade',args:{from:{x:-6,y:1,z:.5},entityId:'7',seekCover:true}},AbortSignal.timeout(10000));
    assert.equal(result.ok,true);assert.equal(c.state.position.y,2);assert.ok(c.state.position.x>3);assert.ok(c.navigationDebug.steps.some(s=>s.kind==='jump'));assert.equal(c.metrics.routePlansReused,1);
  }finally{clearInterval(timer);await c.close();}
});

test('retreat uses a short supported uphill pocket even without a distant escape endpoint',async()=>{
  const c=new OMConnect();Object.assign(c.state,{status:'ready',health:20,food:20,onGround:true,yaw:-90,pitch:0,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}});
  c.client={state:'play',write(){},end(){}};
  c.world.blockAt=p=>Math.floor(p.z)!==0||p.y<1||p.x>=1&&p.y<2||p.x>=3?stone:air;
  c.entities.set(7,{id:7,name:'skeleton',position:{x:-6,y:1,z:.5}});
  const timer=setInterval(()=>{c.state=stepPhysics(c.state,c.control,c.world.blockAt);c.tickLook();c.emit('physics');},50);
  try{
    const result=await runAction(c,{skill:'evade',args:{from:{x:-6,y:1,z:.5},entityId:'7',seekCover:true}},AbortSignal.timeout(10000));
    assert.equal(result.ok,true);assert.equal(c.state.position.y,2);assert.ok(c.state.position.x>1);assert.ok(c.navigationDebug.steps.some(s=>s.kind==='jump'));
  }finally{clearInterval(timer);await c.close();}
});

test('an uphill retreat clears foliage overhead while preserving its support and respecting the mining budget',()=>{
  const leaves={...stone,name:'spruce_leaves'},head={x:0,y:3,z:0},key=p=>`${p.x},${p.y},${p.z}`;
  const getBlock=p=>key(p)===key(head)?leaves:p.z!==0||p.x<0||p.x>1||p.y<1||p.x===1&&p.y<2?stone:air;
  const options={position:{x:.5,y:1,z:.5},from:{x:-6,y:1,z:.5},getBlock,canDig:b=>b.name.endsWith('_leaves'),miningMs:()=>350};
  const plan=planRetreatExcavation(options);assert.deepEqual(plan.position,{x:1,y:2,z:0});assert.deepEqual(plan.dig,[head]);
  assert.equal(planRetreatExcavation({...options,maxMiningMs:200}),null);
  assert.equal(planRetreatExcavation({...options,canDig:()=>false}),null);
  assert.equal(planRetreatExcavation({...options,getBlock:p=>key(p)===key(head)?{...leaves,name:'lava'}:getBlock(p)}),null);
});
