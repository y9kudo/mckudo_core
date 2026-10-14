import test from 'node:test';
import assert from 'node:assert/strict';
import {createPPO,createSAC,createPhysicalEnvironment,createVectorEnvironment,createOMRLBridge,PHYSICAL_FEATURES,PHYSICAL_ACTIONS} from '../src/intelligence.js';
import {denseNetwork} from '../src/learning/dense.js';

test('manual backprop agrees with independent finite differences through both network layers',()=>{
  const network=denseNetwork({inputs:2,outputs:2,hidden:4,seed:7}),cache=network.forward([.2,-.4]),gradient=new Float32Array(network.size),dy=Float32Array.from([.3,-.7]);network.gradient(cache,dy,gradient);
  const objective=()=>{const o=network.forward([.2,-.4]).out;return .3*o[0]-.7*o[1];};
  for(let i=0;i<network.size;i++){const old=network.weights[i],epsilon=.002;network.weights[i]=old+epsilon;const plus=objective();network.weights[i]=old-epsilon;const minus=objective();network.weights[i]=old;assert.ok(Math.abs((plus-minus)/(2*epsilon)-gradient[i])<.0001,`gradient ${i}`);}
});
test('fall damage accumulates across ticks and a water landing resets it',()=>{
  const dry=createPhysicalEnvironment({mobs:0,spawn:{x:.5,y:7,z:.5},spawnJitter:0}),wet=createPhysicalEnvironment({mobs:0,spawn:{x:.5,y:7,z:.5},spawnJitter:0});dry.reset();wet.reset();wet.setBlock({x:0,y:1,z:0},'water');
  for(let i=0;i<40;i++){dry.step(0);wet.step(0);}assert.equal(dry.snapshot().state.health,17);assert.equal(wet.snapshot().state.health,20);
});

for(const [name,factory]of [['PPO',createPPO],['SAC',createSAC]]){
  test(`${name} learns a contextual bandit using actual neural gradients and restores its optimizer`,()=>{
    const policy=factory({inputs:2,actions:2,hidden:16,seed:12,learningRate:.003,gamma:0,batchSize:32});
    for(let batch=0;batch<120;batch++){
      for(let i=0;i<32;i++){
        const target=i%2,observation=target?[0,1]:[1,0],sample=policy.sample?.(observation),action=sample?.action??policy.act(observation,{deterministic:false});
        policy.remember({observation,nextObservation:observation,action,reward:action===target?1:-1,terminated:true,truncated:false,...sample,nextValue:0});
      }
      const result=policy.train();assert.ok(Number.isFinite(result.loss));
    }
    assert.equal(policy.act([1,0]),0);assert.equal(policy.act([0,1]),1);
    const copy=factory({inputs:2,actions:2,hidden:16,seed:12,learningRate:.003,gamma:0,batchSize:32});copy.load(policy.export());assert.deepEqual(copy.export(),policy.export());
    const corrupted=structuredClone(copy.export());corrupted.randomState=-1;assert.throws(()=>copy.load(corrupted));assert.deepEqual(copy.export(),policy.export());
  });
  test(`${name} masks illegal actions and validates capacity and nonfinite observations`,()=>{
    const p=factory({inputs:1,actions:2});for(let i=0;i<50;i++)assert.equal(p.sample?.([0],{mask:[false,true]})?.action??p.act([0],{mask:[false,true],epsilon:1}),1);
    assert.throws(()=>p.act([NaN]));assert.throws(()=>p.act([0],{mask:[false,false]}));assert.throws(()=>factory({inputs:1,actions:2,capacity:32,batchSize:64}));
  });
}
test('PPO rejects stale-policy rollout records; time limits bootstrap the final observation',()=>{
  const p=createPPO({inputs:1,actions:2,batchSize:1}),s=p.sample([1]);
  p.remember({observation:[1],...s,reward:1,nextValue:3,terminated:false,truncated:true});assert.ok(Number.isFinite(p.train().loss));
  assert.throws(()=>p.remember({observation:[1],...s,reward:1,nextValue:0,terminated:true,truncated:false}),/revision/);
  assert.equal(p.snapshot().replaySize,0);
});
test('SAC validates all five checkpoint networks before modifying the policy',()=>{
  const p=createSAC({inputs:1,actions:2}),before=p.export(),bad=structuredClone(before);bad.networks[4].weights[0]=Infinity;
  assert.throws(()=>p.load(bad));assert.deepEqual(p.export(),before);
});
test('physical headless model advances 50ms collision ticks, reaches a real geometric goal and stops at a wall',()=>{
  const env=createPhysicalEnvironment({mobs:0});assert.equal(env.reset().observation.length,18);let r;
  for(let i=0;i<50;i++){r=env.step(1);if(r.terminated||r.truncated)break;}assert.equal(r.info.success,true);assert.throws(()=>env.step(1));
  const wall=createPhysicalEnvironment({mobs:0,layout:'wall'});wall.reset();for(let i=0;i<40;i++)wall.step(1);assert.ok(wall.snapshot().state.position.z>=-.7);
});
test('physical mobs pursue and damage the player; guarding blocks damage and lava is harmful',()=>{
  const idle=createPhysicalEnvironment({mobs:1}),guard=createPhysicalEnvironment({mobs:1,shield:true});idle.reset();guard.reset();
  for(let i=0;i<55;i++){if(!idle.snapshot().done)idle.step(0);guard.step(8);}assert.ok(idle.snapshot().state.health<20);assert.equal(guard.snapshot().state.health,20);
  const lava=createPhysicalEnvironment({mobs:0,layout:'lava'});lava.reset();for(let i=0;i<30&&!lava.snapshot().done;i++)lava.step(1);assert.ok(lava.snapshot().state.health<20);
});
test('physical guarding cannot prevent damage without an equipped fixture shield',()=>{
  const env=createPhysicalEnvironment({mobs:1});assert.equal(env.reset().actionMask[8],false);for(let i=0;i<55&&!env.snapshot().done;i++)env.step(8);assert.ok(env.snapshot().state.health<20);
});
test('invalid masked SAC records leave a full replay buffer and optimizer unchanged',()=>{
  const a=createSAC({inputs:1,actions:2,capacity:32,batchSize:32}),b=createSAC({inputs:1,actions:2,capacity:32,batchSize:32});
  const t={observation:[1],nextObservation:[1],action:0,reward:1,terminated:true,truncated:false};for(let i=0;i<32;i++){a.remember(t);b.remember(t);}
  assert.throws(()=>a.remember({...t,actionMask:[false,true]}),/masked/);assert.deepEqual(a.train(),b.train());assert.deepEqual(a.export(),b.export());
});
test('128 physical environments with independent mobs run on two bounded workers',async()=>{
  const pool=createVectorEnvironment({count:128,workers:2,environment:{kind:'physical',mobs:1}});
  try{const first=await pool.reset();assert.equal(first.length,128);assert.equal(first[0].observation.length,18);const next=await pool.step(Array(128).fill(1));assert.equal(next.length,128);assert.equal(next[0].info.ticks,2);assert.notDeepEqual(next[0].info.mobs,next[1].info.mobs);await assert.rejects(pool.step(Array(128).fill(11)));}finally{await pool.close();}
});
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const fakeClient=()=>({state:{status:'ready',position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0},yaw:180,pitch:0,onGround:true,health:20,food:20},world:{blockAt:p=>p.y<1?stone:air},inventory:{items:()=>[]},entities:new Map(),stopMovement(){this.control={};}});
test('RL bridge releases input even if a policy throws; no player is an attack target',async()=>{
  const c=fakeClient(),policy={snapshot:()=>({inputs:PHYSICAL_FEATURES.length,actions:PHYSICAL_ACTIONS.length}),act(){throw new Error('policy failure');}};
  const bridge=createOMRLBridge({client:c,policy,goal:{x:.5,y:1,z:-4.5},stepMs:50});await assert.rejects(bridge.step(),/policy failure/);assert.equal(bridge.snapshot().busy,false);assert.deepEqual(c.control,{});
  c.entities.set(1,{id:1,kind:'player',position:{x:1,y:1,z:1}});policy.act=(o,{mask})=>{assert.equal(mask[7],false);assert.equal(mask[8],false);return 0;};assert.equal((await bridge.step()).status,'running');
  c.state.health=4;assert.equal((await bridge.step()).status,'blocked');
});
test('RL bridge vetoes movement into unknown chunks, lava and void before sending input',async()=>{
  for(const hazard of [null,{name:'lava',boundingBox:'empty',shapes:[]},air]){
    const c=fakeClient();c.world.blockAt=p=>Math.floor(p.z)<0?hazard:(p.y<1?stone:air);
    const policy={snapshot:()=>({inputs:18,actions:9}),act:(o,{mask})=>{assert.equal(mask[1],false);return 0;}};
    await createOMRLBridge({client:c,policy,goal:{x:.5,y:1,z:-4.5},stepMs:500}).step();
  }
});
