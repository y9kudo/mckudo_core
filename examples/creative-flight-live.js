import {createOMConnect} from '../packages/omconnect/index.js';
const c=createOMConnect({host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25565),version:'1.21.1',username:process.env.MC_NAME||'OMCreative07',auth:'offline',viewDistance:24});
let peak=-Infinity;
try{
  await c.connect();
  const start={...c.state.position};
  c.on('physics',()=>{peak=Math.max(peak,c.state.position.y);});
  const target={x:Math.floor(start.x)+8,y:Math.floor(start.y),z:Math.floor(start.z)+2};
  const result=await c.execute({skill:'navigate',args:{...target,range:0}},{signal:AbortSignal.timeout(30000)});
  console.log(JSON.stringify({start,target,peakY:peak,ascent:peak-start.y,result,corrections:c.metrics.corrections,gameMode:c.state.gameMode,allowFlying:c.state.allowFlying}));
}finally{await c.close();}
