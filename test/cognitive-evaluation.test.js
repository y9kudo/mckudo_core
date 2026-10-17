import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralPlanner,evaluateCognitiveCheckpoint} from '../overmindmc.js';
const before={dimension:'minecraft:overworld',self:{health:20,food:20,position:{x:0,y:64,z:0}},inventory:{}};
const oak={skill:'dig',args:{block:'oak_log',x:2,y:64,z:0}},birch={skill:'dig',args:{block:'birch_log',x:3,y:64,z:0}};
function trained(prefix='train',swap=false){const m=createNeuralPlanner({worldId:'evaluation'});for(let i=0;i<150;i++){m.record({episodeId:`${prefix}:oak:${i}`,before,action:oak,outcome:swap?'success':'failure',verified:true});m.record({episodeId:`${prefix}:birch:${i}`,before,action:birch,outcome:swap?'failure':'success',verified:true});}return m;}
const evaluation=()=>({split:'evaluation',source:'unit',records:Array.from({length:32},(_,i)=>({episodeId:`evaluation:${i}`,before,action:i%2?birch:oak,outcome:i%2?'success':'failure',verified:true}))});

test('evaluation freezes learning, progress requires evidence, and episode replay is deduplicated',()=>{
  const m=createNeuralPlanner({worldId:'evaluation'}),event={episodeId:'episode',before,action:oak,outcome:'progress',verified:true};
  assert.equal(m.record({...event,verified:false}),false);assert.equal(m.record(event),true);assert.equal(m.record(event),false);
  const memory=m.export();m.setMode('evaluate');assert.equal(m.record({...event,episodeId:'other',outcome:'failure'}),false);m.assess(before,oak);assert.deepEqual(m.export(),memory);
  assert.equal(createNeuralPlanner({worldId:'evaluation',memory}).snapshot().trackedEpisodes,1);
  const old={...memory,schemaVersion:1};delete old.provenance;const restored=createNeuralPlanner({worldId:'evaluation',memory:old});assert.deepEqual(restored.export().weights,memory.weights);assert.equal(restored.snapshot().provenanceComplete,false);
});

test('checkpoint selection promotes held-out improvement without mutating either model',()=>{
  const baseline=createNeuralPlanner({worldId:'evaluation'}).export(),candidate=trained().export(),saved=structuredClone(candidate);
  const result=evaluateCognitiveCheckpoint({baseline,candidate,evaluation:evaluation()});assert.equal(result.accepted,true);assert.equal(result.decision,'promote');assert.equal(result.source,'unit');assert.ok(result.metrics.candidateBrier<result.metrics.baselineBrier);assert.deepEqual(result.memory,candidate);assert.deepEqual(candidate,saved);
});

test('regressed or insufficiently evidenced candidates retain the previous checkpoint',()=>{
  const baseline=trained('good').export(),candidate=trained('bad',true).export();
  const result=evaluateCognitiveCheckpoint({baseline,candidate,evaluation:evaluation()});assert.equal(result.accepted,false);assert.equal(result.decision,'retain');assert.deepEqual(result.memory,baseline);
  const short=evaluation();short.records=short.records.slice(0,3);assert.equal(evaluateCognitiveCheckpoint({baseline,candidate,evaluation:short}).decision,'inconclusive');
  const legacy={...candidate,schemaVersion:1};delete legacy.provenance;assert.equal(evaluateCognitiveCheckpoint({baseline,candidate:legacy,evaluation:evaluation()}).decision,'inconclusive');
});

test('evaluation rejects known training overlap, duplicate IDs and a mislabeled dataset',()=>{
  const baseline=createNeuralPlanner({worldId:'evaluation'}).export(),candidate=trained().export();
  const overlapping=evaluation();overlapping.records[0].episodeId='train:oak:0';assert.throws(()=>evaluateCognitiveCheckpoint({baseline,candidate,evaluation:overlapping}),/overlaps/);
  overlapping.records[0].episodeId='train:oak:unseen';assert.throws(()=>evaluateCognitiveCheckpoint({baseline,candidate,evaluation:overlapping}),/overlaps/);
  const duplicate=evaluation();duplicate.records[1].episodeId=duplicate.records[0].episodeId;assert.throws(()=>evaluateCognitiveCheckpoint({baseline,candidate,evaluation:duplicate}),/unique/);
  assert.throws(()=>evaluateCognitiveCheckpoint({baseline,candidate,evaluation:{...evaluation(),split:'training'}}),/evaluation split/);
  assert.throws(()=>evaluateCognitiveCheckpoint({baseline,candidate:{...candidate,worldId:'other'},evaluation:evaluation()}),/different worlds/);
});

test('bounded session provenance preserves split isolation after the recent episode window rolls over',()=>{
  const m=createNeuralPlanner({worldId:'evaluation'});for(let i=0;i<2050;i++)m.record({episodeId:`long-run:${i}`,before,action:birch,outcome:'success',verified:true});
  assert.equal(m.snapshot().trackedEpisodes,2048);assert.equal(m.snapshot().provenanceComplete,true);
  const memory=m.export(),restored=createNeuralPlanner({worldId:'evaluation',memory});assert.equal(restored.snapshot().provenanceComplete,true);
  const overlapping=evaluation();overlapping.records[0].episodeId='long-run:0';assert.throws(()=>evaluateCognitiveCheckpoint({baseline:createNeuralPlanner({worldId:'evaluation'}).export(),candidate:memory,evaluation:overlapping}),/overlaps/);
});

test('an improved aggregate cannot hide a represented dimension regression',()=>{
  const m=createNeuralPlanner({worldId:'evaluation'}),nether={...before,dimension:'minecraft:the_nether'};
  for(let i=0;i<200;i++){m.record({episodeId:`training:overworld:${i}`,before,action:birch,outcome:'success',verified:true});m.record({episodeId:`training:nether:${i}`,before:nether,action:birch,outcome:'failure',verified:true});}
  const data={split:'evaluation',source:'headless',records:Array.from({length:104},(_,i)=>({episodeId:`held:${i}`,before:i<100?before:nether,action:birch,outcome:'success',verified:true}))};
  const result=evaluateCognitiveCheckpoint({baseline:createNeuralPlanner({worldId:'evaluation'}).export(),candidate:m.export(),evaluation:data});
  assert.ok(result.metrics.candidateBrier<result.metrics.baselineBrier);assert.equal(result.accepted,false);assert.match(result.reason,/dimension regressed/);assert.equal(result.source,'headless');
});
