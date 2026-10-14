import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalStack,createHTNPlanner,createMCTSPlanner,createLLMPlanner,createLLMProvider} from '../src/intelligence.js';

test('Goal stack preempts by priority, respects dependencies and requeues on recovery',()=>{
  const s=createGoalStack();s.push({id:'tools',priority:1});s.push({id:'diamonds',priority:10,dependsOn:['tools']});assert.equal(s.next().id,'tools');s.push({id:'escape',priority:100});assert.equal(s.next().id,'escape');s.finish('escape');s.recover();assert.equal(s.next().id,'tools');s.finish('tools');assert.equal(s.next().id,'diamonds');assert.throws(()=>s.push({id:'invalid',dependsOn:['missing']}));
});

test('HTN tries an alternative decomposition after failure and simulates prerequisites without mutating input',()=>{
  const p=createHTNPlanner({primitives:{gather:{applicable:()=>true,apply:s=>({...s,wood:1}),action:()=>({skill:'gather',args:{blockClass:'logs'}})},craft:{applicable:s=>s.wood>=1,apply:s=>({...s,table:true}),action:()=>({skill:'craft',args:{item:'crafting_table'}})}},methods:{table:[{applicable:()=>true,tasks:()=>[{name:'craft'}]},{applicable:()=>true,tasks:()=>[{name:'gather'},{name:'craft'}]}]}}),initial={wood:0};const result=p.plan([{name:'table'}],initial);assert.equal(result.status,'planned');assert.deepEqual(result.actions.map(a=>a.skill),['gather','craft']);assert.equal(result.state.table,true);assert.deepEqual(initial,{wood:0});
  const loop=createHTNPlanner({maxNodes:5,methods:{loop:[{applicable:()=>true,tasks:()=>[{name:'loop'}]}]}});assert.equal(loop.plan([{name:'loop'}],{}).status,'budget');
});

test('MCTS selects a delayed safe payoff and observes explicit computation budget',()=>{
  const model={actions:s=>s.t===0?['unsafe','safe']:['finish'],terminal:s=>s.t>=2,step:(s,a)=>({state:{t:a==='unsafe'?2:s.t+1},reward:a==='unsafe'?-5:a==='finish'?4:0})},p=createMCTSPlanner({model,iterations:100,budgetMs:100,horizon:4,seed:3});const r=p.plan({t:0});assert.equal(r.action,'safe');assert.ok(r.iterations<=100);const c=new AbortController();c.abort(new Error('stop'));assert.throws(()=>p.plan({t:0},{signal:c.signal}),/stop/);
});

test('LLM rejects unapproved actions, falls back and enforces call budget without sending credentials',async()=>{
  let prompt;const p=createLLMPlanner({skills:['wait'],validateAction:a=>a.args.ms<=1000,request:async input=>{prompt=input.prompt;return '{"actions":[{"skill":"shell","args":{}}],"reason":"bad"}';},maxCalls:1,fallback:()=>({actions:[{skill:'wait',args:{ms:20}}],reason:'safe'})});
  const r=await p.plan('wood',{self:{health:20},inventory:{'minecraft:oak_log':1},token:'PRIVATE',session:{password:'SECRET'}});assert.equal(r.source,'fallback');assert.doesNotMatch(prompt,/PRIVATE|SECRET/);assert.equal((await p.plan('wood',{})).source,'fallback');assert.deepEqual(p.snapshot(),{calls:1,failures:1,maxCalls:1,busy:false});
});

test('LLM accepts validated JSON and the HTTP providers construct correct offline-test requests',async()=>{
  for(const provider of ['openai','anthropic','local']){let request;const transport=createLLMProvider({provider,model:'test-model',apiKey:provider==='local'?undefined:'TEST',fetch:async(url,options)=>{request={url:String(url),...options};return {ok:true,text:async()=>JSON.stringify(provider==='openai'?{output:[{content:[{type:'output_text',text:'{"actions":[],"reason":"ok"}'}]}]}:provider==='anthropic'?{content:[{type:'text',text:'{"actions":[],"reason":"ok"}'}]}:{choices:[{message:{content:'{"actions":[],"reason":"ok"}'}}]})};}}),p=createLLMPlanner({request:transport,skills:['wait'],validateAction:()=>true});
    assert.equal((await p.plan('test',{})).source,'llm');assert.equal(JSON.parse(request.body).model,'test-model');assert.ok(request.url.endsWith(provider==='openai'?'/responses':provider==='anthropic'?'/messages':'/chat/completions'));
  }
});

test('LLM cancellation propagates and cannot turn into a successful fallback',async()=>{
  const c=new AbortController(),p=createLLMPlanner({request:()=>new Promise(()=>{}),skills:['wait'],validateAction:()=>true});const result=p.plan('test',{}, {signal:c.signal});c.abort(new Error('cancelled'));await assert.rejects(result,/cancelled/);
});

test('LLM timeout returns a validated local plan even if the provider ignores cancellation',async()=>{
  const p=createLLMPlanner({request:()=>new Promise(()=>{}),skills:['wait'],validateAction:()=>true,timeoutMs:10});const r=await p.plan('test',{});assert.equal(r.source,'fallback');assert.equal(p.snapshot().failures,1);assert.equal(p.snapshot().busy,false);
});
