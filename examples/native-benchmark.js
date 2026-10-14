import {performance} from 'node:perf_hooks';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadNativeKernel,createNativeNavigationBackend} from '../native/index.js';
import {planRoute} from '../packages/omconnect/src/navigation.js';
import {OVERMIND} from '../src/identity.js';
const kernel=loadNativeKernel(),size=[48,6,48],cells=new Uint8Array(size.reduce((n,v)=>n*v,1));
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const terrain=p=>p.x<0||p.x>=48||p.z<0||p.z>=48||p.y<0||p.y>=6?null:p.y===0||p.x===24&&p.y<4&&p.z<40?stone:air;
let i=0;for(let y=0;y<6;y++)for(let z=0;z<48;z++)for(let x=0;x<48;x++)cells[i++]=terrain({x,y,z})===stone?2:1;
const start={x:4,y:1,z:4},goal={x:42,y:1,z:42};
const a=Int32Array.from([4,1,4]),b=Int32Array.from([42,1,42]),dims=Uint32Array.from(size),options=Float64Array.from([0,12000,3,20,6,6]);
const js=()=>planRoute({start,goal,getBlock:terrain,maxNodes:12000,maxDistance:48,maxDrop:3});
const c=()=>kernel.planRoute(cells,dims,a,b,options);
const expected=js(),actual=c();if(expected.status!=='planned'||actual.code!=='PLANNED'||Math.abs(expected.cost-actual.cost)>1e-8)throw new Error('Benchmark route semantics differ.');
const measure=run=>{for(let i=0;i<8;i++)run();const times=[];for(let i=0;i<40;i++){const t=performance.now();run();times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {samples:times.length,medianMs:times[20],p95Ms:times[38]};};
const backend=createNativeNavigationBackend({kernel}),t=performance.now();await backend.planGroundAsync({start,goal,getBlock:terrain,staticGeometry:true,maxNodes:12000,maxDistance:48,maxDrop:3});const firstAdapterMs=performance.now()-t;
const report={version:OVERMIND.version,author:'y9kudo',kind:'static-ground-fixture',node:process.version,cells:cells.length,routeCost:actual.cost,js:measure(js),c:measure(c),firstAdapterMs,
  limitations:'Kernel timings use a prepacked immutable grid. First adapter timing includes capture and one route, on a different snapshot extent. This is not a Minecraft completion or a general speedup claim.'};
await mkdir('data/native-benchmark',{recursive:true});await writeFile('data/native-benchmark/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
