import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {OVERMIND} from './identity.js';

/** A read-only view of one configured local expedition, without another game client. */
export async function startExpeditionMonitor({reportPath,port=4181,clock=Date.now}={}) {
  if(typeof reportPath!=='string'||!reportPath||!Number.isInteger(port)||port<0||port>65535)throw new Error('A reportPath and port 0–65535 are required.');
  const file=resolve(reportPath);let stamp,last,inflight,origin;
  const snapshot=async()=>{
    if(inflight)return inflight;
    inflight=(async()=>{
      try{
        const info=await stat(file);if(info.size>32*1024*1024)throw new Error('Report exceeds 32 MiB.');
        const next=info.mtimeMs+':'+info.size;
        if(next!==stamp){
          const r=JSON.parse(await readFile(file,'utf8')),s=r.expedition?.scenario||{},final=r.final||r.initial||{};
          const completed=new Set(s.completed||[]);
          last={version:r.version||OVERMIND.version,player:r.player||'Agent',status:r.status||'waiting',goalAchieved:r.goalAchieved===true,
            startedAt:r.runStartedAt||r.startedAt,updatedAt:r.heartbeatAt||r.finishedAt||r.startedAt,stage:s.current||null,reason:(r.status==='running'?s.reason||r.reason:r.reason||s.reason)||'',
            steps:(r.goalStages||[]).map(t=>({id:t.id,type:t.type,status:completed.has(t.id)?'completed':t.id===s.current?'active':'pending'})),
            state:{position:final.position,dimension:final.dimension,health:final.health,food:final.food,status:final.status},
            inventory:final.inventory||{},equipment:final.equipment||{},activeAction:r.activeAction||null,totalActions:r.totalActions||0,deaths:r.totalDeaths||0,
            runtime:r.runtime||null,learning:{planner:r.learning?.planner?.updates||0,navigation:r.learning?.navigation?.updates||0},
            actions:(r.actions||[]).slice(-25).map(a=>({at:a.at,skill:a.skill,outcome:a.outcome,detail:a.detail,action:a.action})),
            failures:Object.entries(r.failureCounts||{}).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,20)};
          stamp=next;
        }
        return {...last,available:true,observedAt:clock(),stale:clock()-new Date(last.updatedAt).getTime()>20000};
      }catch{return {...last,available:Boolean(last),stale:true,observedAt:clock(),error:'Waiting for a readable expedition report.'};}
    })().finally(()=>{inflight=null;});return inflight;
  };
  const assets={'/':['expedition.html','text/html'],'/monitor.js':['expedition-monitor.js','text/javascript'],'/monitor.css':['expedition-monitor.css','text/css']};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try{
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Only this local monitor origin is allowed.'});
      const path=new URL(req.url,origin).pathname;
      if(req.method!=='GET')return json(405,{error:'This monitor is read-only.'});
      if(path==='/api/progress')return json(200,await snapshot());
      if(!assets[path])return json(404,{error:'Not found.'});
      const [name,type]=assets[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(await readFile(new URL('./dashboard-public/'+name,import.meta.url)));
    }catch{if(!res.headersSent)json(500,{error:'Monitor unavailable.'});else res.end();}
  });
  server.headersTimeout=5000;server.requestTimeout=10000;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});origin='http://127.0.0.1:'+server.address().port;
  return {url:origin,server,snapshot,close:()=>new Promise((done,reject)=>server.close(e=>e?reject(e):done()))};
}
