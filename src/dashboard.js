import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAgentManager } from './agent-manager.js';
import {createTelemetry} from './platform/monitoring.js';

/** Local dashboard. No shell commands, arbitrary file access or remote bind option. */
export async function startDashboard({ port = 4180, manager = createAgentManager(), telemetry=createTelemetry() } = {}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error("Wrong panel port.");
  await manager.ready;
  const token=randomBytes(32).toString('hex'),files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/vision.css':['vision.css','text/css']};
  let origin;
  const frames=[],previous=new Map();
  const capture=state=>{for(const a of state.agents){const frame={name:a.name,status:a.state?.status,position:a.state?.position,health:a.state?.health,goal:a.goal,decision:a.brain?.decision?.action,lastResult:a.brain?.lastResult};const stamp=JSON.stringify(frame);if(previous.get(a.name)!==stamp){previous.set(a.name,stamp);frames.push({at:Date.now(),...structuredClone(frame)});if(frames.length>256)frames.shift();}}return state;};
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if(req.headers.host!==new URL(origin).host || req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:"Only local panel of this address allowed."});
      const path=new URL(req.url,origin).pathname;
      if(req.method==='GET'&&files[path]){const [file,type]=files[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(new URL('./dashboard-public/'+file,import.meta.url)));}
      if(req.method==='GET'&&path==='/api/state')return json(res,200,{token,...capture(manager.snapshot())});
      if(req.method==='GET'&&path==='/api/diagnostics'){const state=capture(manager.snapshot());return json(res,200,{telemetry:telemetry.snapshot(),agents:state.agents.map(a=>({name:a.name,performance:a.brain?.performance||{}})),replay:frames});}
      if(req.method==='GET'&&path==='/api/metrics'){res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4; charset=utf-8','Cache-Control':'no-store'});const lines=[telemetry.prometheus()];for(const a of manager.snapshot().agents)for(const [phase,t]of Object.entries(a.brain?.performance||{})){const labels=`agent=${JSON.stringify(a.name)},phase=${JSON.stringify(phase)}`;lines.push(`overmind_phase_calls_total{${labels}} ${t.calls}`,`overmind_phase_seconds_sum{${labels}} ${t.totalMs/1000}`,`overmind_phase_last_seconds{${labels}} ${t.lastMs/1000}`);}return res.end(lines.join('\n')+'\n');}
      if(req.method==='GET'&&path==='/api/vision'){
        const query=new URL(req.url,origin).searchParams;
        return json(res,200,manager.vision(query.get('name'),{radius:Number(query.get('radius')||12)}));
      }
      if(req.method!=='POST'||!['/api/command','/api/schematic'].includes(path))return json(res,404,{error:"Not found."});
      const supplied=Buffer.from(String(req.headers['x-overmind-token']||'')),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,403,{error:"New Panel: session content invalid."});
      if(path==='/api/schematic'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)return json(res,413,{error:"The diagram is greater than 8 MiB."});chunks.push(chunk);}
        return json(res,200,{result:manager.importSchematic(String(req.headers['x-overmind-name']||''),Buffer.concat(chunks),String(req.headers['x-overmind-filename']||''))});
      }
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return json(res,413,{error:"Request too big."});}
      const {name,command,args}=JSON.parse(body);return json(res,200,{result:await telemetry.trace('overmind_command',()=>manager.execute(name,command,args))});
    }catch(error){if(!res.headersSent)json(res,400,{error:String(error.message).slice(0,500)});else res.end();}
  });
  server.requestTimeout=185000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  let closing;
  return {url:origin,manager,server,close(){
    if(!closing)closing=(async()=>{try{await manager.close();}finally{await new Promise(resolve=>server.close(resolve));}})();
    return closing;
  }};
}
