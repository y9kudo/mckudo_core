import { readFile } from 'node:fs/promises';
import { createMinecraftAgent, defineMission } from '../mckudo_core.js';

// Goals only: dependencies, resource classes and route decisions live in MCKudo.
const [file='examples/missions/first-tools.json',flag]=process.argv.slice(2);
let agent;
const abort=new AbortController(),stop=()=>abort.abort(new Error('Миссия остановлена пользователем.'));
try {
  if(process.argv.length>4 || flag!==undefined&&flag!=='--check')throw new Error('Запуск: node examples/mission.js путь/mission.json [--check]');
  const steps=JSON.parse(await readFile(file,'utf8'));
  const scenario=defineMission(steps);
  console.log(JSON.stringify(scenario,null,2));
  if(flag!=='--check'){
    agent=createMinecraftAgent({name:process.env.MC_USER||'Atlas',worldId:process.env.MC_WORLD||'my-survival-world',memoryDirectory:'data/agents',
      connection:{host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1'}});
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    agent.client.on('action',e=>console.log(e.skill,e.outcome,e.detail));
    const result=await agent.mission(steps,{timeoutMs:Number(process.env.MC_TIMEOUT_MS||600000),signal:abort.signal});
    console.log('Цели подтверждены:',result.inventory);
  }
}catch(error){console.error('Миссия не завершена:',error.message);process.exitCode=1;}
finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await agent?.close();}
