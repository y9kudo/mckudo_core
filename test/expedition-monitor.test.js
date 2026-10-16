import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startExpeditionMonitor} from '../overmindmc.js';
test('a live monitor serves one configured report, fresh progress and static assets without a Minecraft connection',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'overmind-monitor-')),file=join(dir,'report.json');let monitor;
  try{
    const report={player:'Atlas',status:'running',startedAt:new Date().toISOString(),heartbeatAt:new Date().toISOString(),initial:{private:'not exposed'},final:{health:20,inventory:{'minecraft:iron_ingot':3}},expedition:{scenario:{current:'iron',completed:['wood']}},goalStages:[{id:'wood',type:'resources'},{id:'iron',type:'resources'}],totalActions:6};
    await writeFile(file,JSON.stringify(report));monitor=await startExpeditionMonitor({reportPath:file,port:0});
    const r=await fetch(monitor.url+'/api/progress'),data=await r.json();assert.equal(data.player,'Atlas');assert.equal(data.state.health,20);assert.equal(data.steps[0].status,'completed');assert.equal(data.steps[1].status,'active');assert.equal(data.initial,undefined);assert.equal(data.stale,false);
    for(const asset of ['/','/monitor.js','/monitor.css']){const r=await fetch(monitor.url+asset);assert.equal(r.status,200);assert.ok((await r.text()).length>100);}
    await writeFile(file,JSON.stringify({...report,totalActions:123}));assert.equal((await monitor.snapshot()).totalActions,123);
    await writeFile(file,JSON.stringify({...report,status:'incomplete',reason:'Agent died.',expedition:{scenario:{current:'iron',reason:'Gathering iron.'}}}));assert.equal((await monitor.snapshot()).reason,'Agent died.');
    assert.equal((await fetch(monitor.url+'/api/progress',{method:'POST'})).status,405);
    assert.equal((await fetch(monitor.url+'/api/progress',{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(monitor.url+'/other-report.json')).status,404);
    await writeFile(file,'invalid JSON');const old=await monitor.snapshot();assert.equal(old.stale,true);assert.equal(old.player,'Atlas');assert.ok(!old.error.includes(file));
  }finally{await monitor?.close();await rm(dir,{recursive:true,force:true});}
});
