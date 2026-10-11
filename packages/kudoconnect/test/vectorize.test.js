import test from 'node:test';
import assert from 'node:assert/strict';
import {planSwimRoute,planSwimRouteAsync,volumeClearance,traceVolume,predictElytraTick,stepPhysics} from '../index.js';
import {executeSwim} from '../src/swimming.js';
const air={name:'air',shapes:[]},water={name:'water',shapes:[],getProperties:()=>({level:0})},stone={name:'stone',shapes:[[0,0,0,1,1,1]]};
const pool=p=>p.y<0?stone:p.y<6?water:air;
const point=(x,y=1,z=0)=>({x,y,z});
test('KudoVectorize navigates vertically and diagonally through water',()=>{
  const r=planSwimRoute({start:point(0),goal:point(2,3,2),getBlock:pool,maxNodes:500});
  assert.equal(r.status,'planned');assert.equal(r.mode,'swim');assert.ok(r.waypoints.some(p=>p.y>2));assert.ok(r.airRemainingTicks>=60);
  for(let i=1;i<r.waypoints.length;i++)assert.equal(traceVolume({from:r.waypoints[i-1],to:r.waypoints[i],getBlock:pool}).clear,true);
});
test('body volume rejects head collisions, unloaded cells, lava and waterlogged solids',()=>{
  for(const obstacle of [stone,null,{name:'lava',shapes:[]},{name:'oak_fence',shapes:[[.375,0,.375,.625,1.5,.625]],getProperties:()=>({waterlogged:true})}]){
    const read=p=>p.x===0&&p.y===2&&p.z===0?obstacle:water;
    assert.equal(volumeClearance({position:point(.5,1.05,.5),getBlock:read}).clear,false);
  }
});
test('swept body collision prevents diagonal corner cutting',()=>{
  const read=p=>p.x===1&&p.z===0?stone:water;
  assert.equal(traceVolume({from:point(.5,1,.5),to:point(1.5,1,1.5),getBlock:read}).clear,false);
});
test('air budget prevents deep routes; water breathing permits the same geometry',()=>{
  const options={start:point(0),goal:point(3),getBlock:p=>p.x>=0&&p.x<=3&&p.z===0&&p.y>=1&&p.y<=3?water:stone,airTicks:70,maxNodes:300};
  assert.equal(planSwimRoute(options).reason,'air-budget');
  assert.equal(planSwimRoute({...options,waterBreathing:true}).status,'planned');
});
test('3D search is bounded, cancellable, and invalidated when chunks change',async()=>{
  assert.equal(planSwimRoute({start:point(0),goal:point(30),getBlock:pool,maxNodes:1}).reason,'search-budget');
  assert.throws(()=>planSwimRoute({start:point(0),goal:point(1),getBlock:pool,signal:AbortSignal.abort(new Error('cancelled'))}),/cancelled/);
  let revision=0;const promise=planSwimRouteAsync({start:point(0),goal:point(8),getBlock:pool},{nodesPerSlice:1,getRevision:()=>revision});revision++;
  assert.equal((await promise).reason,'world-changed');
  assert.throws(()=>planSwimRoute({start:point(0),goal:point(1),getBlock:pool,maxDistance:Infinity}),/maxDistance/);
});
test('elytra predictor distinguishes glide, pitch and firework acceleration',()=>{
  const s={position:point(0,100),velocity:point(0,0,1),yaw:0,pitch:0};
  const glide=predictElytraTick(s),boost=predictElytraTick({...s,rocket:true}),turn=predictElytraTick({...s,yaw:90});
  assert.ok(glide.velocity.y<0);assert.ok(boost.velocity.z>glide.velocity.z);assert.ok(turn.velocity.x<0);
  assert.throws(()=>predictElytraTick({...s,pitch:91}),/Elytra/);
});
test('swim executor reaches a 3D target through normal physics input and stops',async()=>{
  const c={state:{position:point(.5,1.05,.5),velocity:point(0,0),health:20,food:20,status:'ready',yaw:0},selfMetadata:{air_supply:300},world:{revision:1,blockAt:pool},control:{},lookAt(){},stopMovement(){this.control={x:0,z:0,jump:false,sneak:false};},async waitFor(predicate){for(let i=0;i<600;i++){if(predicate())return;this.state=stepPhysics(this.state,this.control,pool);}throw new Error('swim did not converge');}};
  const r=await executeSwim(c,{x:1,y:2,z:1},new AbortController().signal);
  assert.equal(r.ok,true);assert.ok(Math.hypot(c.state.position.x-1.5,c.state.position.y-2.05,c.state.position.z-1.5)<.4);assert.equal(c.control.jump,false);
});
