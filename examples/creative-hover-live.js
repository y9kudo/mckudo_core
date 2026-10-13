import {createKudoConnect} from '../packages/kudoconnect/index.js';

const client=createKudoConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',username:process.env.MC_NAME||'KudoHover07',auth:'offline',viewDistance:24});
let low=Infinity,high=-Infinity;
try{
  await client.connect();
  await new Promise(resolve=>setTimeout(resolve,1500));
  if(client.state.gameMode!=='creative')throw new Error('Проверка полёта требует Creative.');
  const start={...client.state.position};
  const from={x:Math.floor(start.x)+3,y:Math.floor(start.y)+4,z:Math.floor(start.z)+2};
  const to={x:from.x+2,y:from.y,z:from.z};
  await client.execute({skill:'creativeFly',args:{...from,land:false}},{signal:AbortSignal.timeout(15000)});
  client.on('physics',()=>{low=Math.min(low,client.state.position.y);high=Math.max(high,client.state.position.y);});
  const result=await client.execute({skill:'creativeFly',args:{...to,land:false,direct:true}},{signal:AbortSignal.timeout(15000)});
  console.log(JSON.stringify({start,from,to,result,low,high,heightChange:high-low,stillFlying:client.state.creativeFlying,corrections:client.metrics.corrections}));
}finally{await client.close();}
