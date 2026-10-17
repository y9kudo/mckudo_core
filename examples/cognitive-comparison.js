import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createNeuralPlanner,createCognitiveEngine,evaluateCognitiveCheckpoint,buildPlannerContext,repairPlan} from '../overmindmc.js';

// Controlled labeled fixtures, not Minecraft execution or a physics simulation.
const worldId='cognitive-comparison',before={dimension:'minecraft:overworld',self:{health:20,food:20,position:{x:0,y:64,z:0}},inventory:{}};
const action=block=>({skill:'dig',args:{block,x:block==='oak_log'?2:3,y:64,z:0}});
const baseline=createNeuralPlanner({worldId}).export(),model=createNeuralPlanner({worldId});
for(let i=0;i<150;i++)for(const block of ['oak_log','birch_log'])model.record({episodeId:`training:${block}:${i}`,before,action:action(block),outcome:block==='oak_log'?'failure':'success',verified:true});
const evaluation={split:'evaluation',source:'unit',records:Array.from({length:64},(_,i)=>({episodeId:`evaluation:${i}`,before:{...before,self:{...before.self,position:{x:.1*(1+i%4),y:64,z:0}}},action:action(i%2?'birch_log':'oak_log'),outcome:i%2?'success':'failure',verified:true}))};
const comparison=evaluateCognitiveCheckpoint({baseline,candidate:model.export(),evaluation});assert.equal(comparison.accepted,true);
const engine=createCognitiveEngine({worldId,assess:(o,a)=>model.assess(o,a)}),choices=['oak_log','birch_log'].map(id=>({id,kind:'reactor',priority:10,action:action(id)}));
assert.equal(engine.rank(before,choices)[0].id,'birch_log');
const samples=[];for(let i=0;i<100;i++){const start=performance.now();engine.rank(before,choices);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);
const context=buildPlannerContext({observation:{inventory:{wood:0,tool:0}},goal:{id:'tool',desired:{fact:'/inventory/tool',eq:1}},skills:['dig','craft'],operators:[
  {id:'alternate',action:{skill:'dig'},requires:{fact:'/inventory/wood',eq:0},effects:[{fact:'/inventory/wood',set:1}]},
  {id:'tool',action:{skill:'craft'},requires:{fact:'/inventory/wood',eq:1},effects:[{fact:'/inventory/tool',set:1}]}
]});
const repaired=await repairPlan(context,['unavailable','tool']);assert.equal(repaired.status,'repaired');assert.deepEqual(repaired.steps,['alternate','tool']);
console.log(JSON.stringify({kind:'offline-cognitive-comparison',source:'unit',gameplayEvidence:false,trainingSamples:model.snapshot().samples,evaluationSamples:comparison.metrics.samples,checkpointDecision:comparison.decision,metrics:comparison.metrics,
  arbitration:{p50Ms:samples[49],p95Ms:samples[94],p99Ms:samples[98],maxMs:samples.at(-1),candidates:choices.length,maxAssessments:engine.snapshot().maxAssessments},repair:repaired},null,2));
