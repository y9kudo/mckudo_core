import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createOMConnect, createVanillaCompatibilityProfile, detectServerVersion, registerVersionProfile, versionSupport } from '../packages/omconnect/index.js';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{
  const match=/^--(version|port|name|output)=(.+)$/.exec(value);
  if(!match)throw new Error(`Unknown argument ${value}`);
  return [match[1],match[2]];
}));
const version=args.version||'1.20.4',port=Number(args.port||25574),name=args.name||`Stone${version.replace(/\D/g,'').slice(0,10)}`;
if(!/^[A-Za-z0-9_]{3,16}$/.test(name)||!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid username or port.');
const support=versionSupport(version);
if(!support.transport)throw new Error(`No installed transport for ${version}; stone test cannot run.`);
const target={x:1,y:80,z:0},report={version,port,name,target,startedAt:new Date().toISOString(),scope:'survival stone mining with an operator-provided diamond pickaxe and prepared stone test site',status:'incomplete',warnings:[]};
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Stone test timed out')),90000);
let unregister=()=>{};
if(!support.native)unregister=registerVersionProfile(createVanillaCompatibilityProfile(version));
const client=createOMConnect({host:'127.0.0.1',port,version,username:name,auth:'offline',viewDistance:8,connectTimeoutMs:25000});
client.on('warning',error=>{if(report.warnings.length<20)report.warnings.push(error.message);});
client.on('decodeFailure',error=>{if(report.warnings.length<20)report.warnings.push(`decode ${error.packetName}: ${error.message}`);});
try{
  const server=await detectServerVersion({port});
  report.server={name:server.serverName,protocol:server.protocol};
  if(server.protocol!==support.protocol)throw new Error(`Server protocol ${server.protocol} does not match ${version} protocol ${support.protocol}.`);
  await client.connect();
  console.log(JSON.stringify({phase:'ready-for-setup',name,version,port,target,position:client.state.position}));
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    controller.signal.throwIfAborted();
    const p=client.state.position,block=client.world.blockAt(target);
    if(p&&Math.abs(p.x-.5)<1&&Math.abs(p.y-80)<1&&Math.abs(p.z-.5)<1&&client.inventory.count('diamond_pickaxe')>0&&block?.name==='stone'&&client.state.onGround)break;
    await delay(100);
  }
  const p=client.state.position,block=client.world.blockAt(target);
  if(!p||Math.abs(p.x-.5)>=1||Math.abs(p.y-80)>=1||Math.abs(p.z-.5)>=1||client.inventory.count('diamond_pickaxe')<1||block?.name!=='stone'||!client.state.onGround)throw new Error(`Site not ready: position=${JSON.stringify(p)} pickaxe=${client.inventory.count('diamond_pickaxe')} target=${block?.name} ground=${client.state.onGround}`);
  report.before={position:{...p},inventory:client.inventory.snapshot(),target:block.name};
  console.log(JSON.stringify({phase:'digging',version,target}));
  report.dig=await client.execute({skill:'dig',args:{...target,block:'stone'}},{signal:controller.signal});
  const pickupDeadline=Date.now()+8000;
  while(Date.now()<pickupDeadline&&client.inventory.count('cobblestone')<1){controller.signal.throwIfAborted();await delay(100);}
  if(client.inventory.count('cobblestone')<1)report.collect=await client.execute({skill:'collect',args:{item:'cobblestone',beforeCount:0,origin:target}},{signal:controller.signal});
  report.after={position:{...client.state.position},inventory:client.inventory.snapshot(),target:client.world.blockAt(target)?.name,corrections:client.metrics.corrections};
  if(report.after.target!=='air'||client.inventory.count('cobblestone')<1)throw new Error('Server did not confirm stone break and cobblestone pickup.');
  report.status='passed';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  clearTimeout(timer);report.finishedAt=new Date().toISOString();
  try{await client.close();}catch(error){report.closeError=error.message;}
  unregister();
  const output=resolve(args.output||`data/version-lab/stone-${version}.json`);
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({phase:'result',version,status:report.status,error:report.error??null,report:output}));
}
