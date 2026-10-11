import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

/** Optional local persistence, partitioned by world and username; no server credentials. */
export function createAgentMemory(directory,worldId){
  const root=join(resolve(directory),createHash('sha256').update(worldId).digest('hex').slice(0,24));
  const path=name=>{if(!/^[A-Za-z0-9_]{1,16}$/.test(name))throw new Error('Неверное имя памяти.');return join(root,name+'.json');};
  let pending=Promise.resolve();
  return {async load(name){const file=path(name);try{if((await stat(file)).size>2*1024*1024)throw new Error('Файл памяти слишком большой.');const m=JSON.parse(await readFile(file,'utf8'));if(m.schemaVersion!==1||m.worldId!==worldId||m.name!==name)throw new Error('Память другого мира/агента.');return m;}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    save(name,state){const file=path(name),content=JSON.stringify({...state,schemaVersion:1,worldId,name});if(Buffer.byteLength(content)>2*1024*1024)throw new Error('Превышен лимит памяти.');const job=pending.catch(()=>{}).then(async()=>{await mkdir(root,{recursive:true});await writeFile(file+'.tmp',content,'utf8');await rename(file+'.tmp',file);});pending=job;return job;},
    flush:()=>pending};
}
