import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {loadNativeKernel,NativeFrameDecoder,createNativeNavigationBackend} from '../native/index.js';
import {planRoute} from '../packages/omconnect/src/navigation.js';
import {denseNetwork} from '../src/learning/dense.js';
const available=existsSync(new URL('../native/build/om_kernel.node',import.meta.url));
if(process.env.OM_REQUIRE_NATIVE==='1'&&!available)throw new Error('Native checks require a built C kernel.');
const kernel=available?loadNativeKernel():null,options={skip:!available};
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
function grid(getBlock,size=[12,8,12]){
  const cells=new Uint8Array(size.reduce((n,v)=>n*v,1));let i=0;
  for(let y=0;y<size[1];y++)for(let z=0;z<size[2];z++)for(let x=0;x<size[0];x++){const b=getBlock({x,y,z});cells[i++]=!b?0:b.name==='air'?1:b.name==='lava'?3:2;}
  return {cells,dims:Uint32Array.from(size)};
}
const native=(terrain,start,goal,{health=20,minHealth=6,maxDamage=6,maxDrop=3,maxNodes=3000}={})=>{
  const {cells,dims}=grid(terrain);return kernel.planRoute(cells,dims,Int32Array.from([start.x,start.y,start.z]),Int32Array.from([goal.x,goal.y,goal.z]),Float64Array.from([0,maxNodes,maxDrop,health,minHealth,maxDamage]));
};

test('C async queue rejects overload and remains usable after jobs finish',options,async()=>{
  const {cells,dims}=grid(p=>p.y===0?stone:air,[32,6,32]);
  const start=Int32Array.from([1,1,1]),goal=Int32Array.from([30,1,30]),opts=Float64Array.from([0,3000,3,20,6,6]);
  const first=kernel.planRouteAsync(cells,dims,start,goal,opts),second=kernel.planRouteAsync(cells,dims,start,goal,opts);
  assert.throws(()=>kernel.planRouteAsync(cells,dims,start,goal,opts),/queue is full/);
  const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.code==='PLANNED'));
  assert.equal((await kernel.planRouteAsync(cells,dims,start,goal,opts)).code,'PLANNED');
});

test('C addon tolerates worker shutdown while native route work is pending',options,async()=>{
  const binary=fileURLToPath(new URL('../native/build/om_kernel.node',import.meta.url));
  for(let i=0;i<3;i++){
    const worker=new Worker(`const {parentPort}=require('node:worker_threads');const c=require(${JSON.stringify(binary)});
      const cells=new Uint8Array(96*6*96).fill(1);cells.fill(2,0,96*96);
      c.planRouteAsync(cells,new Uint32Array([96,6,96]),new Int32Array([1,1,1]),new Int32Array([94,1,94]),new Float64Array([0,100000,3,20,6,6])).catch(()=>{});
      parentPort.postMessage('queued');`,{eval:true});
    try{
      await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    }finally{await worker.terminate();}
  }
});

test('C inference rejects finite weights whose output overflows Float32',options,()=>{
  assert.throws(()=>kernel.denseForward(new Float32Array([1]),new Float32Array([1,1,3e38,3e38]),new Uint32Array([1,1,1])),/model output/);
});

test('C wire codec handles signed VarInts, fragmented/coalesced packets and invalid inputs',options,()=>{
  for(const n of [-2147483648,-1,0,1,127,128,16384,2147483647])assert.equal(kernel.readVarInt(kernel.writeVarInt(n)).value,n);
  assert.equal(kernel.readVarInt(Uint8Array.from([128])),null);
  assert.throws(()=>kernel.readVarInt(Uint8Array.from([255,255,255,255,127])),/32 bits/);
  for(const n of [NaN,1.5,2147483648])assert.throws(()=>kernel.writeVarInt(n));
  const decoder=new NativeFrameDecoder(kernel),a=kernel.framePacket(Buffer.from([0,42,9])),b=kernel.framePacket(Buffer.from([1,7]));
  assert.deepEqual(decoder.push(a.subarray(0,2)),[]);
  assert.deepEqual(decoder.push(Buffer.concat([a.subarray(2),b])),[Buffer.from([0,42,9]),Buffer.from([1,7])]);
  assert.throws(()=>new NativeFrameDecoder(kernel).push(kernel.writeVarInt(-1)),/length/);
  assert.throws(()=>kernel.framePacket(new Uint8Array(0)));
});

test('C ground A* matches static JS geometry, including diagonals, headroom, walls and hazards',options,()=>{
  const start={x:2,y:1,z:2},goal={x:9,y:1,z:9};
  for(let seed=0;seed<32;seed++){
    const terrain=p=>p.y===0?stone:p.x===5&&p.y<=3&&p.z!==seed%10?stone:p.x===6&&p.z===8?{name:'lava'}:air;
    const js=planRoute({start,goal,getBlock:terrain,maxNodes:3000,maxDrop:3,maxDistance:10});
    const c=native(terrain,start,goal);
    assert.equal(c.code==='PLANNED',js.status==='planned',`seed ${seed}`);
    if(js.status==='planned')assert.ok(Math.abs(c.cost-js.cost)<1e-8,`cost ${seed}`);
  }
  assert.equal(native(()=>null,start,goal).code,'START_UNSUPPORTED');
  const corner=p=>p.y===0||p.x===3&&p.z===2||p.x===2&&p.z===3?stone:air;
  assert.notEqual(native(corner,start,{x:3,y:1,z:3}).path.length,4,'diagonal corners cannot be clipped');
});

test('C routes enforce safe falls, bounded searches, typed input lengths and copied async inputs',options,async()=>{
  const terrain=p=>p.y<(p.x<=2?6:1)?stone:air,start={x:2,y:6,z:2},goal={x:3,y:1,z:2};
  assert.equal(native(terrain,start,goal,{maxDrop:6,health:7}).code,'NO_PATH');
  assert.equal(native(terrain,start,goal,{maxDrop:6,health:20}).code,'PLANNED');
  const {cells,dims}=grid(p=>p.y===0?stone:air),a=Int32Array.from([2,1,2]),b=Int32Array.from([9,1,9]),o=Float64Array.from([0,3000,3,20,6,6]);
  const pending=kernel.planRouteAsync(cells,dims,a,b,o);cells.fill(0);assert.equal((await pending).code,'PLANNED');
  assert.throws(()=>kernel.planRoute(new Uint8Array(1),dims,a,b,o),/bounded/);
  assert.throws(()=>kernel.planRoute(new Uint8Array(new SharedArrayBuffer(12*8*12)),dims,a,b,o));
});

test('C dense inference agrees with the trained-network JS layout and rejects nonfinite data',options,()=>{
  const network=denseNetwork({inputs:18,hidden:16,outputs:9,seed:13}),input=Float32Array.from({length:18},(_,i)=>Math.sin(i));
  const expected=network.forward(input).out,actual=kernel.denseForward(input,network.weights,Uint32Array.from([18,16,9]));
  actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-6));
  input[0]=NaN;assert.throws(()=>kernel.denseForward(input,network.weights,Uint32Array.from([18,16,9])),/Nonfinite/);
});

test('native navigation adapter preserves learned/custom/edit fallback and rejects stale captured geometry',options,async()=>{
  const backend=createNativeNavigationBackend({kernel}),terrain=p=>p.y===0?stone:air;
  const request={start:{x:0,y:1,z:0},goal:{x:4,y:1,z:4},getBlock:terrain,staticGeometry:true,maxDrop:3};
  assert.equal((await backend.planGroundAsync(request)).status,'planned');assert.equal(backend.snapshot().native,1);
  assert.equal((await backend.planGroundAsync({...request,edgeCost:()=>1})).status,'planned');assert.equal(backend.snapshot().fallback,1);
  let revision=0;const pending=backend.planGroundAsync(request,{getRevision:()=>revision});revision++;
  await assert.rejects(pending,/changed/);
  const aborted=new AbortController();aborted.abort(new Error('cancel native'));
  await assert.rejects(backend.planGroundAsync({...request,signal:aborted.signal}),/cancel native/);
  const busy=createNativeNavigationBackend({kernel:{planRouteAsync(){throw new Error('Native route queue is full (2 jobs).');}}});
  assert.equal((await busy.planGroundAsync(request)).status,'planned');assert.equal(busy.snapshot().fallback,1);
});
