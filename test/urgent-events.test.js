import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createCore } from '../src/core.js';

test('urgent events wake threat observation before a long polling interval and bursts never overlap', async () => {
  let wake, threat = false, entered, cancelled, polls = 0, concurrent = 0, maximum = 0;
  const started = new Promise(resolve => { entered = resolve; }), stopped = new Promise(resolve => { cancelled = resolve; });
  const core = createCore({ config: { schemaVersion: 4, worldId: 'urgent', name: 'test', tickIntervalMs: 1000, actionTimeoutMs: 5000,
    rules: [{ id: 'work', action: { skill: 'dig', args: {} } }] }, preemptionMs: 2000,
    reactors: [{ id: 'defend', apiVersion: 1, preempt: true, react: o => o.threat ? { action: { skill: 'guard', args: {} }, priority: 900, reason: 'defense' } : { action: null, reason: 'safe' } }],
    adapter: {
      describe: () => ({ protocolVersion: 1, skills: ['dig', 'guard'] }), observe: async () => ({ threat }),
      observeThreats: async () => { polls++; concurrent++; maximum = Math.max(maximum, concurrent); await delay(10); concurrent--; return { threat }; },
      subscribeUrgent: cb => { wake = cb; return () => { wake = null; }; },
      execute: async (action, { signal }) => {
        if (action.skill !== 'dig') return { ok: true };
        entered(); await new Promise(resolve => signal.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true }));
      }
    }
  });
  try {
    core.start(); await started; threat = true;
    for (let i = 0; i < 100; i++) wake();
    await Promise.race([stopped, delay(500).then(() => { throw new Error('urgent event waited for polling'); })]);
    assert.equal(maximum, 1); assert.equal(polls, 1);
  } finally { await core.stop(); }
  assert.equal(wake, null);
});

test('after interrupting work, defense starts without waiting for the normal brain interval',async()=>{
  let wake,threat=false,begin,defended;
  const entered=new Promise(r=>begin=r),guarded=new Promise(r=>defended=r);
  const core=createCore({config:{schemaVersion:4,name:'react',worldId:'reaction',tickIntervalMs:2000,actionTimeoutMs:5000,rules:[{id:'work',action:{skill:'dig',args:{}}}]},preemptionMs:2000,
    reactors:[{id:'defense',apiVersion:1,preempt:true,react:o=>o.threat?{action:{skill:'guard',args:{}},priority:990,reason:'danger'}:{action:null,reason:'safe'}}],
    adapter:{describe:()=>({protocolVersion:1,skills:['dig','guard']}),observe:async()=>({threat}),observeThreats:async()=>({threat}),subscribeUrgent:cb=>{wake=cb;return()=>{};},
      execute:async(action,{signal})=>{if(action.skill==='guard'){defended();await delay(20,undefined,{signal});return {ok:true};}begin();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {ok:true};}}
  });
  try{core.start();await entered;threat=true;wake();await Promise.race([guarded,delay(500).then(()=>{throw new Error('Defense was delayed by the normal interval.');})]);}
  finally{await core.stop();}
});
