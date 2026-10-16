import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as yieldTask} from 'node:timers/promises';
import {RegionalRouteGraph,IncrementalRegionPlanner} from '../src/regional-navigation.js';
import {createNavigationSession} from '../src/navigation-session.js';
import {bodyBounds,supportAt,volumeClearance} from '../src/traversal.js';
import {predictMotion,createMotionProgress} from '../src/motion-v2.js';
import {stepPhysics} from '../src/physics.js';
import {createNavigationRecovery,NAVIGATION_FAILURE_CODES} from '../src/navigation-recovery.js';

const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const flat=p=>p.y<1?stone:air,scope={server:'127.0.0.1:25565',worldId:'fixture',dimension:'minecraft:overworld',minecraftVersion:'1.21.1'};

test('regional LPA* repairs changed edge costs, removal and newly connected regions with exact costs',async()=>{
  const graph=new RegionalRouteGraph();graph.setEdge('a','b',1);graph.setEdge('b','d',1);graph.setEdge('a','c',2);graph.setEdge('c','d',2);
  const planner=new IncrementalRegionPlanner(graph);const first=await planner.plan('a','d');assert.equal(first.cost,2);assert.deepEqual(first.nodes,['a','b','d']);
  assert.equal((await planner.plan('a','d')).expanded,0);
  graph.setEdge('b','d',10);const repaired=await planner.plan('a','d');assert.equal(repaired.cost,4);assert.deepEqual(repaired.nodes,['a','c','d']);assert.equal(planner.snapshot().resets,1);
  graph.removeEdge('c','d');assert.equal((await planner.plan('a','d')).cost,11);
  graph.setEdge('a','e',.5);graph.setEdge('e','d',.5);assert.equal((await planner.plan('a','d')).cost,1);
  graph.removeEdge('b','d');graph.removeEdge('e','d');assert.equal((await planner.plan('a','d')).status,'blocked');
  assert.throws(()=>graph.setEdge('a','b',-1));
});

test('regional search yields, respects budgets and resumes after cancellation without corrupting labels',async()=>{
  const graph=new RegionalRouteGraph();for(let i=0;i<180;i++)graph.setEdge(String(i),String(i+1),1);
  const planner=new IncrementalRegionPlanner(graph),abort=new AbortController();
  const pending=planner.plan('0','180',{signal:abort.signal,nodesPerSlice:1});await yieldTask();abort.abort(new Error('urgent defense'));
  await assert.rejects(pending,/urgent defense/);assert.equal((await planner.plan('0','180',{maxExpansions:2})).reason,'search-budget');
  assert.equal((await planner.plan('0','180')).cost,180);
  const dynamic=new IncrementalRegionPlanner(graph),changing=dynamic.plan('0','180',{nodesPerSlice:1});await yieldTask();graph.setEdge('179','180',2);
  assert.equal((await changing).reason,'world-changed');assert.equal((await dynamic.plan('0','180')).cost,181);
});

test('incremental regional costs match independent shortest paths through repeated directed graph changes',async()=>{
  const graph=new RegionalRouteGraph();let seed=51;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<20;i++)for(let n=0;n<4;n++){const target=String(random()%20);if(target!==String(i))graph.setEdge(String(i),target,1+random()%12);}
  const planner=new IncrementalRegionPlanner(graph);
  const reference=(start,goal)=>{
    const costs=new Map([[start,0]]),remaining=new Set(graph.nodes.keys());remaining.add(start);
    while(remaining.size){const id=[...remaining].sort((a,b)=>(costs.get(a)??Infinity)-(costs.get(b)??Infinity))[0],cost=costs.get(id)??Infinity;remaining.delete(id);if(!Number.isFinite(cost))break;
      for(const e of graph.nodes.get(id)?.out.values()??[])costs.set(e.to,Math.min(costs.get(e.to)??Infinity,cost+e.cost));
    }return costs.get(goal)??Infinity;
  };
  for(let n=0;n<120;n++){
    const from=String(random()%20),to=String(random()%20);if(from!==to){if(n%3)graph.setEdge(from,to,1+random()%20);else graph.removeEdge(from,to);}
    const goal=String(random()%20),start=n%17===0?'2':'0',result=await planner.plan(start,goal);
    assert.equal(result.cost??Infinity,reference(start,goal),'mutation '+n);
  }
});

test('navigation caches valid routes, detects relevant edits and revalidates imported hints under a strict world scope',async()=>{
  let revision=0,reads=0,blocked=false;
  const read=p=>{reads++;return blocked&&p.x===3&&p.z===0&&p.y===1?stone:flat(p);};
  const options={start:{x:0,y:1,z:0},goal:{x:8,y:1,z:0}},session=createNavigationSession({getBlock:read,getRevision:()=>revision,scope});
  assert.equal((await session.plan(options)).status,'planned');reads=0;assert.equal((await session.plan(options)).cacheHit,true);assert.equal(reads,0);
  const memory=session.exportMemory();assert.equal(memory.schemaVersion,2);
  const untrusted=structuredClone(memory);untrusted.routes[0].facts=[];
  const rechecked=createNavigationSession({getBlock:read,getRevision:()=>revision,scope,memory:untrusted});assert.equal((await rechecked.plan(options)).cacheHit,false);assert.equal(rechecked.snapshot().searches,1);
  blocked=true;revision++;const repaired=await session.plan(options);assert.equal(repaired.status,'planned');assert.equal(repaired.cacheHit,false);assert.ok(repaired.steps.every(s=>s.position.x!==3||s.position.z!==0||s.position.y!==1));
  const restored=createNavigationSession({getBlock:read,getRevision:()=>revision,scope,memory});assert.equal((await restored.plan(options)).cacheHit,false);
  assert.throws(()=>createNavigationSession({getBlock:read,scope:{...scope,worldId:'other'},memory}),/scope/);
  assert.throws(()=>createNavigationSession({getBlock:read,scope,memory:{...memory,schemaVersion:99}}),/schema/);
  session.close();await assert.rejects(session.plan(options),/closed/);
});

test('long-distance planning returns bounded segments and never treats an unknown boundary as traversable air',async()=>{
  const session=createNavigationSession({getBlock:flat,scope,segmentDistance:96});
  const route=await session.plan({start:{x:0,y:1,z:0},goal:{x:10000,y:1,z:0}});
  assert.equal(route.status,'planned');assert.equal(route.partial,true);assert.equal(route.strategy,'hierarchical-segment');assert.ok(route.target.x<=96);assert.equal(route.finalGoal.x,10000);assert.ok(session.snapshot().connections>0);
  const limited=createNavigationSession({getBlock:p=>p.x>24?null:flat(p),scope});
  const frontier=await limited.plan({start:{x:0,y:1,z:0},goal:{x:1000,y:1,z:0},maxNodes:2000});
  assert.equal(frontier.status,'planned');assert.equal(frontier.partial,true);assert.ok(frontier.target.x<=24);assert.ok(frontier.unknown.length>0);
});

test('a superseded navigation request cancels its old cooperative search',async()=>{
  const session=createNavigationSession({getBlock:flat,scope}),abort=new AbortController();
  const old=session.plan({start:{x:0,y:1,z:0},goal:{x:90,y:1,z:90},signal:abort.signal},{nodesPerSlice:1});
  const rejection=assert.rejects(old,/superseded/);
  assert.equal((await session.plan({start:{x:0,y:1,z:0},goal:{x:2,y:1,z:0}})).status,'planned');await rejection;
});

test('shared geometry recognizes partial supports, low ceilings, unknown geometry and tall collision shapes below the feet',()=>{
  const slab={...stone,name:'stone_slab',shapes:[[0,0,0,1,.5,1]]};
  const read=p=>p.y===0?slab:air,position={x:.5,y:.5,z:.5};
  assert.equal(supportAt({position,getBlock:read}).height,.5);assert.equal(volumeClearance({position,getBlock:read}).clear,true);
  const fence={...stone,name:'oak_fence',shapes:[[.375,0,.375,.625,1.5,.625]]};
  assert.equal(volumeClearance({position:{x:.5,y:1,z:.5},getBlock:p=>p.y===0?fence:air}).clear,false);
  assert.equal(volumeClearance({position,getBlock:()=>null}).reason,'unloaded');
  const ceiling=p=>p.y===2?stone:read(p);assert.equal(volumeClearance({position,getBlock:ceiling}).clear,false);
  assert.equal(volumeClearance({position,height:1.5,getBlock:ceiling}).clear,true);
  assert.equal(bodyBounds(position).maxY,2.3);
});

test('motion predictions exactly reuse tick physics without changing the live state; progress detection is bounded',()=>{
  const state={position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0},onGround:true,health:20,food:20,yaw:-90},before=structuredClone(state),control={x:1,z:0,sprint:true};
  const predicted=predictMotion({state,control,getBlock:flat,ticks:8});let actual=structuredClone(state);for(let i=0;i<8;i++)actual=stepPhysics(actual,control,flat);
  assert.deepEqual(predicted.state,actual);assert.deepEqual(state,before);assert.equal(predicted.samples.length,8);
  let now=0;const progress=createMotionProgress({clock:()=>now,timeoutMs:500});const target={x:3,y:1,z:.5};
  assert.equal(progress.update(state.position,target).stuck,false);now=501;assert.equal(progress.update(state.position,target).stuck,true);assert.equal(progress.update({...state.position,x:1},target).stuck,false);
});

test('navigation recovery covers canonical failures and never retries one unchanged context indefinitely',()=>{
  const policy=createNavigationRecovery({maxAttempts:2});policy.confirmSafe({x:0,y:1,z:0});
  for(const code of NAVIGATION_FAILURE_CODES)assert.equal(policy.decide({code,goalId:code}).status,'retry');
  assert.equal(policy.decide({code:'INVALID_SUPPORT',goalId:'retreat'}).strategy,'return-safe');
  assert.equal(policy.decide({code:'STEP_STALLED',goalId:'goal'}).code,'STUCK');assert.equal(policy.decide({code:'STEP_STALLED',goalId:'goal'}).status,'retry');assert.equal(policy.decide({code:'STEP_STALLED',goalId:'goal'}).status,'blocked');
  assert.equal(policy.decide({code:'STUCK',goalId:'goal',contextRevision:1}).status,'retry');
});
