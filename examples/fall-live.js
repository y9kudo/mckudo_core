import {createKudoConnect,planRoute} from '../kudoconnect/index.js';
import {mkdir,writeFile} from 'node:fs/promises';
const client=createKudoConnect({username:process.env.MC_USERNAME||'Owen'});
const report={startedAt:new Date().toISOString(),status:'running',server:'127.0.0.1:25565'};
const floor=p=>Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(p[k])]));
try{
  await client.connect();await client.waitFor(()=>client.state.onGround,{timeoutMs:5000});
  report.before=client.snapshot();const start=floor(client.state.position),candidates=[];
  for(let x=-12;x<=12;x++)for(let z=-12;z<=12;z++)for(const dy of [-1,-2,-3,-4]){
    const goal={x:start.x+x,y:start.y+dy,z:start.z+z},b=client.world.blockAt(goal),under=client.world.blockAt({...goal,y:goal.y-1});
    if(b?.boundingBox==='empty'&&under?.boundingBox==='block')candidates.push({goal,d:Math.hypot(x,z)+Math.abs(dy)*3});
  }
  candidates.sort((a,b)=>a.d-b.d);let selected;
  for(const {goal}of candidates.slice(0,32)){
    const route=planRoute({start,goal,getBlock:p=>client.world.blockAt(p),maxDrop:16,fallPolicy:{health:client.state.health,minHealthAfter:6},maxNodes:2000});
    if(route.status==='planned'&&route.steps.some(s=>s.kind==='drop')){selected={goal,route};break;}
  }
  if(!selected)throw new Error('Рядом нет достижимого наблюдаемого спуска для проверки.');
  report.route=selected.route;report.result=await client.execute({skill:'navigate',args:{...selected.goal,range:0,bridge:false}},{signal:AbortSignal.timeout(30000)});
  report.after=client.snapshot();report.healthDelta=report.before.health-report.after.health;
  if(!client.state.onGround||Math.abs(client.state.position.y-selected.goal.y)>.12)throw new Error('Приземление на целевой высоте не подтверждено.');
  report.status='passed';
}catch(error){report.status='failed';report.reason=error.message;report.after=client.snapshot();}
finally{await client.close();await mkdir('data',{recursive:true});report.finishedAt=new Date().toISOString();await writeFile('data/fall-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1;}
