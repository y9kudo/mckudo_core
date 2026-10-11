import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fork,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import protocol from 'minecraft-protocol';
import {sourceDigest,rankRace,sharingCandidate} from './benchmark/race-metrics.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const worker=path.join(root,'examples/benchmark/diamond-worker.js');
const manifest=JSON.parse(await fs.readFile(path.join(root,'data/diamond-race-sources.json'),'utf8'));
const host=process.env.MC_HOST||'127.0.0.1',port=Number(process.env.MC_PORT||25565);
const minutes=Number(process.env.MC_TEST_MINUTES||15),uiPort=Number(process.env.MC_RACE_UI_PORT||4181);
if(!Number.isFinite(minutes)||minutes<0.5||minutes>120)throw new Error('MC_TEST_MINUTES: 0.5–120.');
if(manifest.releases.length!==6||new Set(manifest.releases.map(r=>r.version)).size!==6)throw new Error('Expected six distinct historical versions.');
for(const r of manifest.releases)if(sourceDigest(r.directory)!==r.sourceSHA256)throw new Error('Modified snapshot '+r.version);
if(process.argv.includes('--check')){
 for(const release of manifest.releases){const p=spawnSync(process.execPath,[worker,'--check'],{cwd:root,env:{...process.env,MC_RACE_WORKER:JSON.stringify({release})},encoding:'utf8',timeout:20000});if(p.status!==0)throw new Error(p.stderr||p.error?.message);console.log(p.stdout.trim());}
 process.exit(0);
}
const ping=await new Promise((resolve,reject)=>protocol.ping({host,port,closeTimeout:3000},(e,r)=>e?reject(e):resolve(r)));
if(ping.version.protocol!==767)throw new Error('This race requires Java 1.21.1 (protocol 767).');
if(ping.players.max-ping.players.online<6)throw new Error('Need six free server slots.');
const runId='diamond-'+new Date().toISOString().replace(/[:.]/g,'-');
const suffix=Date.now().toString(36).slice(-4);
const output=path.join(root,'data',runId);await fs.mkdir(output,{recursive:true});
const report={schemaVersion:1,runId,mode:'cooperative-live-race',status:'preparing',createdAt:new Date().toISOString(),timeLimitMs:minutes*60000,
 server:{host,port,version:ping.version,players:ping.players},dependencies:manifest.dependencies,dependencyLockSHA256:manifest.dependencyLockSHA256,
 processId:process.pid,notes:['Shared live world, unequal spawn positions and resource interference: not an isolated version speed ranking.','Same installed protocol dependencies; immutable historical core/adapter source.','0.2 wood/diamond rules; 0.3 published workshop operators plus diamond goal requiring a received tool; 0.4 catalog resource profile; 0.5+ native diamond goal.','Common IPC logistics helper uses actual movement and item drops. It is outside historical brains; no chat or inventory injection.','First-life trial; no automatic respawn. No diamonds are donated. Own ore break plus observed matching pickup and inventory required.'],agents:{},transfers:[],warnings:[]};
const children=new Map(),closed=new Set(),ready=new Set(),cooldowns=new Map();let saving=Promise.resolve(),stopping=false,server,transferId=0;
const save=()=>{const json=JSON.stringify(report,null,2);saving=saving.catch(()=>{}).then(async()=>{await fs.writeFile(path.join(output,'report.json.tmp'),json);await fs.rename(path.join(output,'report.json.tmp'),path.join(output,'report.json'));});return saving;};
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const page=()=>`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MCKudo · Diamond Race</title><style>body{background:#11151a;color:#e6edf3;font:16px system-ui;margin:32px}h1{font-size:26px}small,p{color:#a5b4c4}table{border-collapse:collapse;width:100%;background:#19212a}th,td{padding:12px;text-align:left;border-bottom:1px solid #314052}th{color:#71d9d2}code{font-size:12px}a{color:#71d9d2}</style><h1>MCKudo · Кооперативная гонка за алмазом</h1><p>${escape(report.status)} · ${report.startedAt?Math.max(0,Math.floor(((report.finishedAtMs||Date.now())-report.startedAt)/1000)):0} с · лимит ${minutes} мин</p><table><tr><th>Агент / версия</th><th>Состояние</th><th>Здоровье</th><th>Инвентарь</th><th>Цель / причина</th></tr>${Object.values(report.agents).map(a=>`<tr><td>${escape(a.name)}<br><small>${escape(a.version)}</small></td><td>${escape(a.status)}${a.diamondEvidence?' · 💎':''}</td><td>${escape(a.state?.health)}</td><td><code>${escape(JSON.stringify(a.state?.inventory||{}))}</code></td><td>${escape(a.plan?.stage||'')}<br><small>${escape(a.reason||a.plan?.reason||'')}</small></td></tr>`).join('')}</table><p>Передачи: ${report.transfers.filter(t=>t.status==='dropped').length}. Исходники версий неизменны; логистический помощник общий. Полученный в подарок алмаз не считается собственной добычей.</p><p>Автор: y9kudo · результаты: report.json</p>${stopping?'':'<script>setTimeout(()=>location.reload(),3000)</script>'}</html>`;
const stop=async reason=>{
 if(stopping)return;stopping=true;report.finishedAtMs=Date.now();report.finishedAt=new Date().toISOString();report.stopReason=reason;
 report.ranking=rankRace(report.agents);report.status=report.startedAt?(report.ranking.length?'winner-confirmed':'incomplete'):'not-started';
 for(const child of children.values())if(child.connected)child.send({type:'stop'});
 const deadline=Date.now()+8000;while(closed.size<children.size&&Date.now()<deadline)await delay(100);
 for(const [name,child]of children){if(!closed.has(name)){child.kill();report.warnings.push('Forced process cleanup: '+name);}report.agents[name].processClosed=closed.has(name)||child.killed;}
 for(const r of manifest.releases)if(sourceDigest(r.directory)!==r.sourceSHA256)report.warnings.push('Snapshot changed: '+r.version);
 await save();await fs.writeFile(path.join(output,'report.html'),page());
 const csv=['version,name,status,first_log_ms,wooden_pickaxe_ms,stone_pickaxe_ms,iron_pickaxe_ms,diamond_ms,health,transfers_sent'];
 for(const a of Object.values(report.agents)){const m=a.milestones||{};const firstLog=Math.min(...Object.entries(m).filter(([id])=>/_log$|_stem$/.test(id)).map(([,n])=>n));csv.push([a.version,a.name,a.status,Number.isFinite(firstLog)?firstLog:'',m.wooden_pickaxe??'',m.stone_pickaxe??'',m.iron_pickaxe??'',a.diamondEvidence?.elapsedMs??'',a.state?.health??'',report.transfers.filter(t=>t.from===a.name&&t.status==='dropped').length].join(','));}
 await fs.writeFile(path.join(output,'results.csv'),csv.join('\n')+'\n');
 if(server)await new Promise(resolve=>server.close(resolve));
 console.log(JSON.stringify({status:report.status,reason,ranking:report.ranking,output,agents:Object.values(report.agents).map(a=>({version:a.version,name:a.name,status:a.status,inventory:a.state?.inventory,health:a.state?.health}))},null,2));
};
process.once('SIGINT',()=>void stop('user-interrupt'));process.once('SIGTERM',()=>void stop('user-interrupt'));
try{
 server=http.createServer((req,res)=>{if(req.method!=='GET'||!['/','/state'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',req.url==='/state'?'application/json; charset=utf-8':'text/html; charset=utf-8');res.end(req.url==='/state'?JSON.stringify(report):page());});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(uiPort,'127.0.0.1',resolve);});
 console.log(JSON.stringify({dashboard:`http://127.0.0.1:${uiPort}/`,output,phase:'connecting-six-versions'}));
 for(const original of manifest.releases){
  const release={...original,name:original.name+suffix};const name=release.name;
  report.agents[name]={...release,directory:undefined,status:'connecting',milestones:{},actions:{},errors:[]};
  const child=fork(worker,[],{cwd:root,env:{...process.env,MC_RACE_WORKER:JSON.stringify({release,host,port,runId})},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});children.set(name,child);
  const log=await fs.open(path.join(output,release.id+'.log'),'a');
  child.stdout.on('data',d=>void log.write(d));child.stderr.on('data',d=>void log.write(d));
  child.on('exit',(code,signal)=>{closed.add(name);report.agents[name].exit={code,signal};void log.close();});
  child.on('error',e=>{report.agents[name].status='error';report.agents[name].reason=e.message;});
  child.on('message',m=>{
   const a=report.agents[name];
   if(m.type==='sample'){const {type,name:ignored,...state}=m;Object.assign(a,state);if(a.diamondEvidence&&!stopping)void stop('first-confirmed-diamond');}
   if(m.type==='ready'){ready.add(name);a.status='ready';a.transport=m.transport;a.capabilities=m.capabilities;a.initial=m.initial;}
   if(m.type==='started')a.startSkewMs=m.at-report.startedAt;
   if(m.type==='warning')a.lastWarning=String(m.message).slice(0,300);
   if(m.type==='fatal'){a.status='error';a.reason=m.reason;}
   if(m.type==='death'){a.status='dead';a.deathAt=m.at;}
   if(m.type==='transfer'){report.transfers.push({...m,type:undefined});if(report.transfers.length>1000)report.transfers.shift();}
   if(m.type==='action'){a.lastAction=m.action;if(m.phase==='finish')a.lastResult=m.result;}
  });
 }
 const connectDeadline=Date.now()+50000;
 while(ready.size<6&&!stopping){if(Date.now()>connectDeadline||[...children.keys()].some(n=>report.agents[n].status==='error'||closed.has(n)))throw new Error('Six-agent ready barrier failed.');await delay(100);}
 if(stopping)throw new Error('Stopped before ready.');
 report.startedAt=Date.now()+300;report.status='running';report.fromEmptyInventory=Object.values(report.agents).every(a=>Object.keys(a.initial.inventory).length===0);
 for(const child of children.values())child.send({type:'start',startedAt:report.startedAt});await save();
 console.log('COMMON_START',JSON.stringify({at:report.startedAt,names:Object.keys(report.agents),empty:report.fromEmptyInventory}));
 let nextProgress=0,nextTrade=Date.now()+10000;
 while(!stopping&&Date.now()<report.startedAt+report.timeLimitMs){
  const now=Date.now();
  if(await fs.access(path.join(output,'stop.request')).then(()=>true,()=>false)){await stop('stop-request');break;}
  if(now>=nextTrade){const offer=sharingCandidate(report.agents,now,cooldowns);if(offer){const job={...offer,id:++transferId,type:'transfer',at:now};cooldowns.set(offer.from,now+30000);children.get(offer.from)?.send(job);report.transfers.push({...job,status:'requested'});}nextTrade=now+10000;}
  if(now>=nextProgress){await save();console.log('PROGRESS',JSON.stringify({seconds:Math.round((now-report.startedAt)/1000),agents:Object.values(report.agents).map(a=>({version:a.version,status:a.status,hp:a.state?.health,inventory:a.state?.inventory,action:a.lastAction?.skill,reason:a.reason||a.plan?.reason})),transfers:report.transfers.filter(t=>t.status==='dropped').length}));nextProgress=now+15000;}
  if([...children.keys()].every(n=>closed.has(n)||['dead','error','disconnected','finished'].includes(report.agents[n].status)))break;
  await delay(250);
 }
 await stop('time-limit-or-no-live-agents');
}catch(e){report.warnings.push(e.message);await stop(e.message);process.exitCode=1;}
