import {setTimeout as delay} from 'node:timers/promises';
import {create263Client} from './java263-runtime.js';

const client=create263Client({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),username:process.env.MC_NAME||'ArKaDiU656',auth:'offline',viewDistance:12,connectTimeoutMs:20000});
client.on('warning',e=>console.log(JSON.stringify({warning:e.message})));
client.on('decodeFailure',e=>console.log(JSON.stringify({decodeFailure:e.packetName,error:e.message})));
client.on('kicked',reason=>console.log(JSON.stringify({kicked:reason})));
client.on('end',reason=>console.log(JSON.stringify({ended:reason,abort:client.connectionAbort.signal.reason?.message})));
try{
  await client.connect();console.log(JSON.stringify({phase:'connected',state:client.snapshot(),recipes:client.recipeBook.snapshot()}));
  for(let i=0;i<15;i++){await delay(1000);if(client.state.status!=='ready')throw new Error(`Проверка устойчивости: ${client.state.status}; ${client.connectionAbort.signal.reason?.message||''}`);}
  console.log(JSON.stringify({phase:'stable',state:client.snapshot(),recipes:client.recipeBook.snapshot()}));
}finally{await client.close();}
