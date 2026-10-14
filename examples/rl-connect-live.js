import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createOMConnect,detectServerVersion} from '../packages/omconnect/index.js';
import {createPPO,createSAC,createOMRLBridge} from '../src/intelligence.js';

const options=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('='))),checkpoint=JSON.parse(await readFile(options.model||'data/physical-ppo/checkpoint.json','utf8'));
if(checkpoint.featureSchema!=='om-physical-v1'||checkpoint.actionSchema!=='om-controls-v1'||!['ppo','sac'].includes(checkpoint.algorithm))throw new Error('Incompatible physical checkpoint');
const policy=(checkpoint.algorithm==='ppo'?createPPO:createSAC)(checkpoint.config);policy.load(checkpoint.model);
const host=options.host||'127.0.0.1',port=Number(options.port||25565),detected=await detectServerVersion({host,port}),client=createOMConnect({host,port,username:options.name||'ArthasRL',version:detected.version,auth:'offline'}),records=[],report={name:client.options.username,version:detected.version,algorithm:checkpoint.algorithm,status:'starting',records};
const cancellation=new AbortController(),timer=setTimeout(()=>cancellation.abort(new Error('Live RL trial time limit')),60000);process.once('SIGINT',()=>cancellation.abort());
try{
  await client.connect({signal:cancellation.signal});const start={...client.state.position},y=Math.floor(start.y);
  // Only a short, level, observed corridor is allowed in this transfer probe.
  const clear=p=>{const foot=client.world.blockAt(p),head=client.world.blockAt({...p,y:p.y+1}),support=client.world.blockAt({...p,y:p.y-1});return foot?.boundingBox==='empty'&&head?.boundingBox==='empty'&&support?.boundingBox==='block'&&!/water|lava|fire|cactus/.test(foot.name);};
  const directions=[{axis:'north',x:0,z:-1},{axis:'east',x:1,z:0},{axis:'south',x:0,z:1},{axis:'west',x:-1,z:0}];let corridor;
  for(let length=4;length>=2&&!corridor;length--)for(const direction of directions)if(Array.from({length:length+1},(_,n)=>n).every(n=>clear({x:Math.floor(start.x)+direction.x*n,y,z:Math.floor(start.z)+direction.z*n}))){corridor={...direction,length};break;}
  if(!corridor)throw new Error('No safe level corridor at spawn; choose a flat spawn or move the agent before retrying');
  const goal={x:start.x+corridor.x*corridor.length,y:start.y,z:start.z+corridor.z*corridor.length},bridge=createOMRLBridge({client,policy,goal,axis:corridor.axis,stepMs:100});report.start=start;report.goal=goal;report.axis=corridor.axis;report.healthBefore=client.state.health;
  for(let i=0;i<120;i++){const step=await bridge.step({signal:cancellation.signal});records.push({...step,transition:undefined});if(step.status!=='running'){report.status=step.success?'passed':step.status;break;}}
  if(report.status==='starting')report.status='incomplete';report.final=client.snapshot();
}catch(error){report.status='blocked';report.error=error.message;}finally{clearTimeout(timer);client.close();const directory=resolve(options.out||'data/rl-connect-live');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
