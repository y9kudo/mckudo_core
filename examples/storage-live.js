import { createKudoConnect } from '../kudoconnect/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
const client = createKudoConnect({username:process.env.MC_USERNAME || 'Henry',host:process.env.MC_HOST || '127.0.0.1',port:Number(process.env.MC_PORT || 25565)});
const report = {startedAt:new Date().toISOString(),status:'running'};
client.on('warning',e=>console.log(e.message));
try {
  await client.connect(); await client.waitFor(()=>client.state.onGround,{timeoutMs:5000}); report.before = client.snapshot();
  // Wait briefly for the requested chunk batch, without assuming unseen chunks are empty.
  await client.execute({skill:'wait',args:{durationMs:1500}});
  const found = await client.findStorages({radius:64,count:8,signal:AbortSignal.timeout(10000)});
  report.candidates = found.storages; report.scanTruncated = found.truncated;
  if (!found.storages.length) { report.status='not-tested'; report.reason='В полученных чанках рядом нет хранилищ.'; }
  else {
    report.results=[];
    for(const storage of found.storages) {
      try {
        const result = await client.execute({skill:'lootChest',args:{...storage.position,maxStacks:4}},{signal:AbortSignal.timeout(30000)});
        report.results.push({kind:storage.kind,position:storage.position,result});console.log(JSON.stringify(report.results.at(-1)));
      } catch(error){report.results.push({kind:storage.kind,position:storage.position,error:error.message});}
    }
    report.status = report.results.some(r=>r.error) ? 'failed' : report.results.some(r=>r.result.transferred.length) ? 'passed' : 'not-tested';
    if(report.status==='not-tested')report.reason='Окна открыты, но доступных предметов для подбора не оказалось.';
  }
} catch(error){report.status='failed';report.reason=error.message;}
finally {
  report.after=client.snapshot();await client.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});
  await writeFile('data/kudoconnect-storage.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.status==='failed'?1:0;
}
