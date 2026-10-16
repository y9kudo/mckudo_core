import {performance} from 'node:perf_hooks';
import {planRouteAsync,createNavigationSession,RegionalRouteGraph,IncrementalRegionPlanner} from '../packages/omconnect/index.js';
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]],hardness:1.5};
const flat=p=>p.y<1?stone:air,scope={server:'offline-fixture',worldId:'benchmark',dimension:'minecraft:overworld',minecraftVersion:'1.21.1'};
const fixtures=[
  {name:'flat-96',goal:{x:96,y:1,z:0},read:flat},
  {name:'forest-48',goal:{x:48,y:1,z:0},read:p=>p.y<1||p.y<4&&p.x>0&&p.x<48&&p.x%5===0&&Math.abs(p.z)%5!==2?stone:air},
  {name:'hills-64',goal:{x:64,y:9,z:0},read:p=>p.y<1+Math.floor(Math.max(0,Math.min(64,p.x))/8)?stone:air},
  {name:'narrow-cave',goal:{x:32,y:1,z:0},read:p=>p.y<1||p.y===3||p.z!==0?stone:air},
  {name:'bridge-gap',goal:{x:8,y:1,z:0},read:p=>p.y===0&&p.z===0&&(p.x<4||p.x>6)?stone:air,options:{bridgeBudget:3,bridgeBlock:'minecraft:cobblestone'}},
  {name:'excavation',goal:{x:8,y:1,z:0},read:p=>p.y<1||p.x===4?stone:air,options:{canDig:()=>true}},
  {name:'partial-slabs-safe-rejection',goal:{x:4,y:1,z:0},read:p=>p.y<1?{...stone,shapes:[[0,0,0,1,.5,1]]}:air,expected:'blocked'},
  {name:'closed-door-safe-rejection',goal:{x:6,y:1,z:0},read:p=>p.z!==0?stone:p.x===3&&p.y>=1&&p.y<=2?{...stone,name:'oak_door',shapes:[[0,0,0,.1875,1,1]]}:flat(p),expected:'blocked'},
  {name:'parkour-gap-safe-rejection',goal:{x:8,y:1,z:0},read:p=>p.y===0&&p.z===0&&(p.x<4||p.x>5)?stone:air,expected:'blocked'},
  {name:'water-ground-safe-rejection',goal:{x:8,y:1,z:0},read:p=>p.x===4?{name:'water',boundingBox:'empty',shapes:[]}:flat(p),expected:'blocked'},
  {name:'occupied-corridor',goal:{x:8,y:1,z:0},read:p=>p.z!==0?stone:flat(p),options:{occupied:p=>p.x===4},expected:'blocked'}
];
const quantiles=values=>{const a=values.toSorted((x,y)=>x-y),at=p=>a[Math.ceil(p*a.length)-1];return {p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)};};
const results=[];
for(const fixture of fixtures){
  let reads=0;const getBlock=p=>{reads++;return fixture.read(p);},session=createNavigationSession({getBlock,getRevision:()=>0,scope}),options={start:{x:0,y:1,z:0},goal:fixture.goal,...fixture.options};
  const cpu=process.cpuUsage(),raw=[],cached=[];let outcome;
  for(let i=0;i<9;i++){let begin=performance.now();const baseline=await planRouteAsync({...options,getBlock,maxDistance:128,maxNodes:12000});raw.push(performance.now()-begin);begin=performance.now();const next=await session.plan(options);cached.push(performance.now()-begin);outcome=next.status;if(baseline.status!==(fixture.expected||'planned')||next.status!==baseline.status)throw new Error('Unexpected benchmark result: '+fixture.name);}
  const used=process.cpuUsage(cpu);results.push({name:fixture.name,outcome,astarRepeated:quantiles(raw),sessionColdMs:cached[0],sessionRepeated:quantiles(cached),reads,cpuMs:(used.user+used.system)/1000,session:session.snapshot()});session.close();
}
for(const length of [1000,10000]){
  const session=createNavigationSession({getBlock:flat,scope});let start={x:0,y:1,z:0},segments=0;const begin=performance.now();
  while(start.x<length){const route=await session.plan({start,goal:{x:length,y:1,z:0}});if(route.status!=='planned'||!route.target||route.target.x<=start.x)throw new Error('Long planning failed.');start=route.target;if(++segments>256)throw new Error('Segment budget exhausted.');}
  results.push({name:'planning-only-'+length,totalPlanningMs:performance.now()-begin,segments,finalPlannedCell:start,session:session.snapshot()});session.close();
}
const graph=new RegionalRouteGraph();for(let i=0;i<1000;i++)graph.setEdge(String(i),String(i+1),1);
const incremental=new IncrementalRegionPlanner(graph),cold=await incremental.plan('0','1000');graph.setEdge('999','1000',2);const repaired=await incremental.plan('0','1000');
results.push({name:'regional-cost-update',initialExpansions:cold.expanded,repairExpansions:repaired.expanded,initialCost:cold.cost,repairedCost:repaired.cost});
let revision=0,changed=false;const dynamic=createNavigationSession({getBlock:p=>changed&&p.x===8&&p.z===0&&p.y===1?stone:flat(p),getRevision:()=>revision,scope});
await dynamic.plan({start:{x:0,y:1,z:0},goal:{x:16,y:1,z:0}});changed=true;revision++;const detour=await dynamic.plan({start:{x:0,y:1,z:0},goal:{x:16,y:1,z:0}});
results.push({name:'dynamic-obstacle',outcome:detour.status,invalidations:dynamic.snapshot().invalidations,searches:dynamic.snapshot().searches});dynamic.close();
const concurrentStart=performance.now();const concurrent=await Promise.all(Array.from({length:8},async(_,id)=>{
  const session=createNavigationSession({getBlock:flat,scope:{...scope,worldId:'concurrent-'+id}}),begin=performance.now();
  const route=await session.plan({start:{x:0,y:1,z:0},goal:{x:64,y:1,z:16}});session.close();return {status:route.status,ms:performance.now()-begin};
}));
if(concurrent.some(r=>r.status!=='planned'))throw new Error('A concurrent planning job failed.');
results.push({name:'eight-concurrent-planners',completed:concurrent.length,totalMs:performance.now()-concurrentStart,...quantiles(concurrent.map(r=>r.ms))});
console.log(JSON.stringify({kind:'offline-planning-benchmark',minecraftExecution:false,node:process.version,platform:process.platform,results,rssMiB:process.memoryUsage().rss/1048576},null,2));
