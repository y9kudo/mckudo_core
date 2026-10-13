import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startDashboard } from '../src/dashboard.js';
test('local dashboard exposes state and authenticated controls, rejecting foreign origins and tokens',async()=>{
  const calls=[],manager={snapshot:()=>({agents:[],log:[],worldId:'test'}),vision:(...args)=>{calls.push(['vision',...args]);return {status:'ready',cells:[]};},importSchematic:(...args)=>{calls.push(['schematic',...args]);return {blockCount:1};},execute:async(...args)=>{calls.push(args);return {ok:true};},close:async()=>{}};
  const d=await startDashboard({port:0,manager});
  try {
    const home=await fetch(d.url);assert.equal(home.status,200);assert.match(await home.text(),/Центр агентов/);
    const state=await(await fetch(d.url+'/api/state')).json();assert.equal(state.worldId,'test');
    const post=(headers={})=>fetch(d.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({name:'Owen',command:'pause'})});
    assert.equal((await post()).status,403);assert.equal((await post({'X-MCKudo-Token':state.token,Origin:'https://unrelated.example'})).status,403);assert.equal(calls.length,0);
    assert.equal((await post({'X-MCKudo-Token':state.token,Origin:d.url})).status,200);assert.equal(calls[0][1],'pause');
    const vision=await fetch(d.url+'/api/vision?name=Owen&radius=8');assert.equal(vision.status,200);assert.equal(calls[1][0],'vision');assert.equal(calls[1][2].radius,8);
    const upload=headers=>fetch(d.url+'/api/schematic',{method:'POST',headers:{'X-MCKudo-Name':'Owen','X-MCKudo-Filename':'test.nbt',...headers},body:Buffer.from([10,0,0])});
    assert.equal((await upload({})).status,403);
    assert.equal((await upload({'X-MCKudo-Token':state.token})).status,200);
    assert.equal(calls[2][0],'schematic');
    const wrongHost=await new Promise((resolve,reject)=>{http.get(d.url+'/api/state',{headers:{Host:'rebound.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(wrongHost,403);
  }finally{await d.close();}
});
