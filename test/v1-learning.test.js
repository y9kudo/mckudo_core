import test from 'node:test';
import assert from 'node:assert/strict';
import {createDQN,createRewardAPI,createNoveltyBonus,createHeadlessEnvironment,createVectorEnvironment,createCurriculum,createPolicyRunner} from '../src/intelligence.js';

test('Double DQN learns unseen contextual decisions and restores model exactly',()=>{
  const p=createDQN({inputs:2,actions:2,hidden:16,batchSize:32,seed:19});
  for(let i=0;i<512;i++){const x=(i/511)*2-1,a=i%2;p.remember({observation:[x,1],action:a,reward:a===(x>0?1:0)?1:-1,nextObservation:[0,1],terminated:true,truncated:false});}
  const score=()=>Array.from({length:80},(_,i)=>{const x=(i+.37)/40-1;return +(p.act([x,1])===(x>0?1:0));}).reduce((a,b)=>a+b,0);
  const before=score();p.train({steps:600});const after=score();assert.ok(after>=76,`${before} -> ${after}`);assert.ok(after>before);
  const saved=p.export(),restored=createDQN({...saved.config,seed:999});restored.load(saved);assert.deepEqual(restored.predict([.27,1]),p.predict([.27,1]));assert.equal(restored.snapshot().replaySize,0);assert.equal(restored.snapshot().updates,600);
  restored.transfer(saved);assert.equal(restored.snapshot().updates,0);assert.deepEqual(restored.predict([-.1,1]),p.predict([-.1,1]));assert.throws(()=>restored.load({...saved,weights:[NaN]}));
});

test('DQN bootstraps through time-limit truncation but never through terminal death',()=>{
  const make=terminal=>{const p=createDQN({inputs:1,actions:2,hidden:4,batchSize:1,gamma:.9,seed:5}),m=p.export();m.weights.fill(0);m.target.fill(0);m.weights[m.weights.length-2]=10;m.target[m.target.length-2]=10;p.load(m);p.remember({observation:[1],action:0,reward:1,nextObservation:[1],terminated:terminal,truncated:!terminal});p.train();return p.predict([1])[0];};
  assert.equal(make(false),10);assert.ok(make(true)<10);
});

test('DQN masks unsafe actions and BC learns explicit encoded demonstrations',()=>{
  const p=createDQN({inputs:1,actions:2,hidden:8,batchSize:1,seed:7});assert.equal(p.act([1],{epsilon:1,mask:[false,true]}),1);assert.throws(()=>p.act([1],{mask:[false,false]}));
  const data=Array.from({length:40},(_,i)=>({observation:[i%2?1:-1],action:i%2}));p.imitate(data,{epochs:150});assert.equal(p.act([-1]),0);assert.equal(p.act([1]),1);assert.throws(()=>p.remember({observation:[1],action:0,reward:1,nextObservation:[1],terminated:true}));
});

test('Reward API separates potential shaping, death and bounded episodic novelty',()=>{
  const r=createRewardAPI({terms:{damage:t=>t.damage,goal:t=>t.success?10:0},potential:x=>x[0],gamma:.9});
  assert.deepEqual(r.evaluate({observation:[2],nextObservation:[3],terminated:false,damage:-1,success:false}).parts,{damage:-1,goal:0,shaping:.7000000000000002});
  assert.equal(r.evaluate({observation:[2],nextObservation:[100],terminated:true,damage:0,success:true}).reward,8);
  const n=createNoveltyBonus({capacity:2,scale:1});assert.equal(n.visit('a'),1);assert.ok(n.visit('a')<1);n.visit('b');n.visit('c');assert.equal(n.snapshot().entries,2);n.reset();assert.equal(n.visit('a'),1);
});

test('Headless environment is seed reproducible, reaches diamond by valid macro actions and requires reset',()=>{
  const a=createHeadlessEnvironment({seed:5,task:'diamond',maxSteps:1000}),b=createHeadlessEnvironment({seed:5,task:'diamond',maxSteps:1000});let o=a.reset();assert.deepEqual(o,b.reset());
  let final;for(let i=0;i<1000;i++){const craft=[9,8,11,7,6,5].find(n=>o.actionMask[n]),[dx,dz,near]=o.observation,action=craft??(near?4:Math.abs(dx)>Math.abs(dz)?dx>0?3:2:dz>0?1:0);const result=a.step(action);assert.deepEqual(result,b.step(action));if(result.terminated||result.truncated){final=result;break;}o={observation:result.observation,actionMask:result.info.actionMask};}
  assert.equal(final.info.success,true);assert.equal(a.snapshot().state.diamond,1);assert.throws(()=>a.step(4));
});

test('128 independent headless environments run on two workers with explicit final observations',async()=>{
  const pool=createVectorEnvironment({count:128,workers:2,environment:{maxSteps:4}});
  try{const first=await pool.reset();assert.equal(first.length,128);assert.equal(first[127].id,127);assert.notDeepEqual(first[0].observation,first[1].observation);
    let results;for(let i=0;i<4;i++)results=await pool.step(Array(128).fill(10));assert.ok(results.every(r=>r.truncated&&!r.terminated));const reset=await pool.reset({indices:[0,127]});assert.deepEqual(reset.map(r=>r.id),[0,127]);assert.equal(pool.snapshot().workers,2);assert.equal(pool.snapshot().steps,512);
  }finally{await pool.close();}await assert.rejects(pool.reset(),/closed/);
});

test('Curriculum advances and regresses only after a complete success window',()=>{
  const c=createCurriculum({stages:[{task:'wood'},{task:'stone'}],window:5});for(let i=0;i<4;i++)c.record(true);assert.equal(c.snapshot().index,0);c.record(true);assert.equal(c.current().task,'stone');for(let i=0;i<5;i++)c.record(false);assert.equal(c.current().task,'wood');
});

test('Policy runner learns from the actual after-observation and never invents successful inventory',async()=>{
  const p=createDQN({inputs:1,actions:2,hidden:4,batchSize:1}),r=createRewardAPI({terms:{gained:t=>(t.after.inventory.wood||0)-(t.before.inventory.wood||0)}});let wood=0;
  const runner=createPolicyRunner({adapter:{observe:async()=>({self:{health:20},inventory:{wood}}),execute:async()=>{wood++;}},policy:p,encode:o=>[o.inventory.wood],actions:[{allowed:()=>true,action:()=>({skill:'gather',args:{}})},{allowed:()=>false,action:()=>({skill:'wait',args:{}})}],reward:r,goal:o=>o.inventory.wood>=1});
  const result=await runner.step();assert.equal(result.status,'terminated');assert.equal(result.transition.reward,1);assert.deepEqual(result.transition.nextObservation,[1]);assert.equal(p.snapshot().replaySize,1);
});
