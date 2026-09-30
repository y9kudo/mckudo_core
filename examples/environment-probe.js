import {createKudoConnect} from '../kudoconnect/index.js';
import {mkdir,writeFile} from 'node:fs/promises';
const c=createKudoConnect({username:process.env.MC_USERNAME||'Owen',host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565)});
const report={startedAt:new Date().toISOString(),status:'running',warnings:[],recipes:0};
c.on('warning',e=>{report.warnings.push(e.message);console.log(e.message);});
c.on('decodeFailure',e=>{void mkdir('data',{recursive:true}).then(()=>writeFile('data/decode-last.json',JSON.stringify({...e,bytes:e.bytes.toString('base64')},null,2)));});
try {
  const connecting=c.connect();c.client.on('declare_recipes',p=>{report.recipes=p.recipes.length;});await connecting;
  if(c.state.status==='dead')await c.respawn();
  await c.execute({skill:'wait',args:{durationMs:2000}}); report.before=c.snapshot(); report.resources={};
  for(const group of ['#logs','#ores','#workstations','#containers'])report.resources[group]=await c.world.findBlocks({classes:[group],position:c.state.position,radius:128,count:12,signal:AbortSignal.timeout(10000)});
  report.status='passed';
}catch(e){report.status='failed';report.reason=e.message;}
finally{report.after=c.snapshot();await c.close();report.finishedAt=new Date().toISOString();await mkdir('data',{recursive:true});await writeFile('data/environment-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1;}
