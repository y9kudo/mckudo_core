import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAgentManager } from './agent-manager.js';

/** Local dashboard. No shell commands, arbitrary file access or remote bind option. */
export async function startDashboard({ port = 4180, manager = createAgentManager() } = {}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Неверный порт панели.');
  await manager.ready;
  const token=randomBytes(32).toString('hex'),files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
  let origin;
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      if(req.headers.host!==new URL(origin).host || req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Разрешена только локальная панель этого адреса.'});
      const path=new URL(req.url,origin).pathname;
      if(req.method==='GET'&&files[path]){const [file,type]=files[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(new URL('./dashboard-public/'+file,import.meta.url)));}
      if(req.method==='GET'&&path==='/api/state')return json(res,200,{token,...manager.snapshot()});
      if(req.method!=='POST'||path!=='/api/command')return json(res,404,{error:'Не найдено.'});
      const supplied=Buffer.from(String(req.headers['x-mckudo-token']||'')),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,403,{error:'Обнови панель: токен сессии недействителен.'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return json(res,413,{error:'Запрос слишком большой.'});}
      const {name,command,args}=JSON.parse(body);return json(res,200,{result:await manager.execute(name,command,args)});
    }catch(error){if(!res.headersSent)json(res,400,{error:String(error.message).slice(0,500)});else res.end();}
  });
  server.requestTimeout=65000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  let closing;
  return {url:origin,manager,server,close(){
    if(!closing)closing=(async()=>{try{await manager.close();}finally{await new Promise(resolve=>server.close(resolve));}})();
    return closing;
  }};
}
