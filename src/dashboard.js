import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAgentManager } from './agent-manager.js';
import {createTelemetry} from './platform/monitoring.js';
import {createDashboardTextures} from './dashboard-textures.js';
import {OVERMIND} from './identity.js';

/** Local dashboard. No shell commands, arbitrary file access or remote bind option. */
export async function startDashboard({ port = 4180, manager = createAgentManager(), telemetry=createTelemetry(),textureArchive,textures=createDashboardTextures() } = {}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error("Wrong panel port.");
  await manager.ready;
  if(textureArchive)await textures.load(textureArchive);
  const token=randomBytes(32).toString('hex'),files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/program-builder.js':['program-builder.js','text/javascript'],'/vision3d.js':['vision3d.js','text/javascript'],'/style.css':['style.css','text/css'],'/vision.css':['vision.css','text/css']};
  const vendor={'/vendor/three.module.js':new URL(import.meta.resolve('three')),'/vendor/three.core.js':new URL('./three.core.js',import.meta.resolve('three'))};
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
      if(req.method==='GET'&&vendor[path]){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=3600'});return res.end(await readFile(vendor[path]));}
      if(req.method==='GET'&&path==='/api/state')return json(res,200,{token,version:OVERMIND.version,...capture(manager.snapshot())});
      if(req.method==='GET'&&path==='/api/textures')return json(res,200,textures.snapshot());
      if(req.method==='GET'&&path==='/api/catalog')return json(res,200,manager.catalog(new URL(req.url,origin).searchParams.get('name')));
      if(req.method==='GET'&&path.startsWith('/api/textures/')){
        const id=decodeURIComponent(path.slice('/api/textures/'.length).replace(/\.png$/,''));
        if(!/^block\/[a-z0-9_/-]+$/.test(id))return json(res,404,{error:'Unknown texture.'});
        const texture=textures.texture(id);if(!texture)return json(res,404,{error:'Texture is not loaded.'});
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=3600'});return res.end(texture.bytes);
      }
      if(req.method==='GET'&&path==='/api/vision3d'){
        const query=new URL(req.url,origin).searchParams;
        const volume=await manager.vision3d(query.get('name'),{radius:Number(query.get('radius')||12),down:Number(query.get('down')||8),up:Number(query.get('up')||16)});
        return json(res,200,{...volume,textures:textures.snapshot(),palette:(volume.palette||[]).map(block=>({...block,model:textures.describe(block.name,block.properties)}))});
      }
      if(req.method==='GET'&&path==='/api/diagnostics'){const state=capture(manager.snapshot());return json(res,200,{telemetry:telemetry.snapshot(),agents:state.agents.map(a=>({name:a.name,performance:a.brain?.performance||{}})),replay:frames});}
      if(req.method==='GET'&&path==='/api/metrics'){res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4; charset=utf-8','Cache-Control':'no-store'});const lines=[telemetry.prometheus()];for(const a of manager.snapshot().agents)for(const [phase,t]of Object.entries(a.brain?.performance||{})){const labels=`agent=${JSON.stringify(a.name)},phase=${JSON.stringify(phase)}`;lines.push(`overmind_phase_calls_total{${labels}} ${t.calls}`,`overmind_phase_seconds_sum{${labels}} ${t.totalMs/1000}`,`overmind_phase_last_seconds{${labels}} ${t.lastMs/1000}`);}return res.end(lines.join('\n')+'\n');}
      if(req.method==='GET'&&path==='/api/vision'){
        const query=new URL(req.url,origin).searchParams;
        return json(res,200,manager.vision(query.get('name'),{radius:Number(query.get('radius')||12)}));
      }
      if(req.method!=='POST'||!['/api/command','/api/schematic','/api/textures'].includes(path))return json(res,404,{error:"Not found."});
      const supplied=Buffer.from(String(req.headers['x-overmind-token']||'')),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,403,{error:"New Panel: session content invalid."});
      if(path==='/api/textures'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024*1024)return json(res,413,{error:'Texture archive exceeds 128 MiB.'});chunks.push(chunk);}
        return json(res,200,{result:textures.import(Buffer.concat(chunks),decodeURIComponent(String(req.headers['x-overmind-filename']||'Resource pack')))});
      }
      if(path==='/api/schematic'){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)return json(res,413,{error:"The diagram is greater than 8 MiB."});chunks.push(chunk);}
        return json(res,200,{result:manager.importSchematic(String(req.headers['x-overmind-name']||''),Buffer.concat(chunks),decodeURIComponent(String(req.headers['x-overmind-filename']||'')))});
      }
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>131072)return json(res,413,{error:"Request too big."});}
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
