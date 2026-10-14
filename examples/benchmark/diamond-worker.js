import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {sourceDigest,cleanInventory,diamondEvidence} from './race-metrics.js';

const settings=JSON.parse(process.env.MC_RACE_WORKER||'null');
if(!settings)throw new Error('Use examples/diamond-race.js to run this worker.');
const {release,host,port,runId}=settings;
const send=(type,body={})=>process.connected&&process.send({type,name:release.name,...body});
if(sourceDigest(release.directory)!==release.sourceSHA256)throw new Error('Historical source has changed.');
const coreModule=await import(pathToFileURL(path.join(release.directory,'overmindmc.js')));
if(coreModule.OVERMIND.version!==release.version)throw new Error('Runtime identity differs from manifest.');
const native=typeof coreModule.createMinecraftBrain==='function';
if(process.argv.includes('--check')){if(native){const transport=await import(pathToFileURL(path.join(release.directory,'omconnect/index.js')));if(typeof transport.createOMConnect!=='function')throw new Error('Native factory missing.');}console.log(JSON.stringify({version:release.version,native,exports:Object.keys(coreModule).length}));process.exit(0);}
const require=createRequire(new URL('../../package.json',import.meta.url));
let client,bot,adapter,core,catalog,currentAction,startedAt,ending=false,ended=false,sampler,loops=0,transfer;
const mined=[],pickups=[],drops=new Map(),counts={},milestones={},errors=[];
if(release.resume){Object.assign(counts,release.resume.actions);Object.assign(milestones,release.resume.milestones);}
let status='connecting',reason='',deathAt=null,proof=null,lastCPU=process.cpuUsage(),lastCPUAt=Date.now(),cpuMs=0;
const controller=new AbortController();
const clip=(list,value,n=128)=>{list.push(value);if(list.length>n)list.shift();};
const inventory=()=>cleanInventory(native?client?.inventory.snapshot():Object.fromEntries((bot?.inventory?.items()||[]).map(i=>[i.name,(bot.inventory.items().filter(j=>j.name===i.name).reduce((n,j)=>n+j.count,0))])));
const position=()=>{const p=native?client?.state.position:bot?.entity?.position;return p?{x:p.x,y:p.y,z:p.z}:null;};
const health=()=>native?client?.state.health:bot?.health;
const sample=()=>{
 if(ending||!client&&!bot)return;
 const now=Date.now(),inv=inventory(),p=position();
 if(startedAt){
  for(const [item,n]of Object.entries(inv))if(n>0&&milestones[item]===undefined)milestones[item]=(release.resume?.elapsedMs||0)+now-startedAt;
  if(health()===0&&!deathAt){deathAt=now;status='dead';reason='First life ended.';send('death',{at:now});}
  proof ||= diamondEvidence({startedAt,now,inventory:inv,mined,pickups,deathAt});
  if(proof&&!proof.continuationApplied){proof.elapsedMs+=(release.resume?.elapsedMs||0);proof.continuationApplied=true;}
 }
 const cpu=process.cpuUsage(lastCPU);cpuMs+=(cpu.user+cpu.system)/1000;
 const cpuPercent=(cpu.user+cpu.system)/1000/Math.max(1,now-lastCPUAt)*100;
 lastCPU=process.cpuUsage();lastCPUAt=now;
 let plan;
 try{plan=core?.survival?.snapshot()||core?.snapshot()?.brain||{reason};}catch{}
 send('sample',{sampledAt:now,status,reason,startedAt,deathAt,diamondEvidence:proof,milestones,actions:counts,errors:[...errors],
  state:{position:p,health:health(),food:native?client?.state.food:bot?.food,inventory:inv,dimension:native?client?.state.dimension:bot?.game?.dimension},
  plan,metrics:{cpuMs,cpuPercent,rssBytes:process.memoryUsage().rss,corrections:native?client?.metrics.corrections:null,loops}});
};
const events=c=>{
 c.on('action:start',e=>{currentAction=e.action;send('action',{at:Date.now(),phase:'start',action:e.action});});
 c.on('action:finish',e=>{
  const action=currentAction;currentAction=null;
  const key=`${action?.skill||'unknown'}/${e.outcome}`;counts[key]=(counts[key]||0)+1;
  if(e.outcome==='failure')clip(errors,{at:Date.now(),skill:action?.skill,reason:String(e.detail||e.reason||'failure').slice(0,240)},20);
  if(native&&e.outcome==='success'&&action?.skill==='dig'&&/^(?:minecraft:)?(?:deepslate_)?diamond_ore$/.test(action.args?.block||'')){
   const {x,y,z}=action.args;const b=client.world.blockAt({x,y,z});
   if(b&&['air','cave_air','void_air'].includes(b.name))clip(mined,{at:Date.now(),block:action.args.block.replace('minecraft:',''),position:{x,y,z}});
  }
  send('action',{at:Date.now(),phase:'finish',action,result:e});sample();
 });
};
const legacySetup=async()=>{
 const mineflayer=require('mineflayer'),pathfinder=require('mineflayer-pathfinder');
 bot=mineflayer.createBot({host,port,username:release.name,version:'1.21.1',auth:'offline',hideErrors:true,respawn:false});
 bot.loadPlugin(pathfinder.pathfinder);
 bot.on('error',e=>{clip(errors,{at:Date.now(),reason:e.message},20);send('warning',{message:e.message});});
 bot.on('kicked',e=>{reason=JSON.stringify(e);status='disconnected';});
 bot.on('death',()=>{deathAt=Date.now();status='dead';send('death',{at:deathAt});void core?.pause();});
 bot.on('end',()=>{if(!ending){status='disconnected';reason||='Server disconnected client.';sample();void finish();}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Legacy spawn timeout')),25000);bot.once('spawn',()=>{clearTimeout(timer);resolve();});bot.once('error',reject);});
 await Promise.race([bot.waitForChunksToLoad(),delay(10000).then(()=>{throw new Error('Chunks timeout');})]);
 const moves=new pathfinder.Movements(bot);moves.canDig=false;moves.allow1by1towers=false;moves.maxDropDown=2;bot.pathfinder.setMovements(moves);
 const module=await import(pathToFileURL(path.join(release.directory,'adapters/mineflayer.js')));
 adapter=module.createMineflayerAdapter(bot,{goals:pathfinder.goals});
 bot.on('diggingCompleted',b=>{if(/^(?:deepslate_)?diamond_ore$/.test(b.name))clip(mined,{at:Date.now(),block:b.name,position:{x:b.position.x,y:b.position.y,z:b.position.z}});});
 bot.on('playerCollect',(collector,entity)=>{if(collector.id===bot.entity?.id){const item=entity.getDroppedItem?.();clip(pickups,{at:Date.now(),own:true,item:item?.name,position:{x:entity.position.x,y:entity.position.y,z:entity.position.z}});sample();}});
 bot.inventory.on('updateSlot',()=>sample());
 if(release.version==='0.2.0'){
  const logs=['oak_log','birch_log','spruce_log','acacia_log','jungle_log','dark_oak_log','mangrove_log','cherry_log'];
  const diamondRules=['diamond_ore','deepslate_diamond_ore'].map((block,i)=>({id:'diamond-'+i,priority:50,when:{any:['iron_pickaxe','diamond_pickaxe','netherite_pickaxe'].map(n=>({fact:'/inventory/minecraft:'+n,gte:1}))},action:{skill:'gather',args:{block:'minecraft:'+block,count:1}}}));
  core=coreModule.createCore({config:{schemaVersion:2,name:release.name,worldId:runId,tickIntervalMs:200,actionTimeoutMs:20000,rules:[...diamondRules,...logs.map((block,i)=>({id:'wood-'+i,priority:10,when:{fact:'/inventory/minecraft:'+block,lt:6},action:{skill:'gather',args:{block:'minecraft:'+block,count:1}}}))]},adapter});
 }else if(release.version==='0.3.0'){
  const config=JSON.parse(fs.readFileSync(path.join(release.directory,'examples/brain.json'),'utf8'));
  const operators=JSON.parse(fs.readFileSync(path.join(release.directory,'examples/operators.json'),'utf8'));
  config.goals.unshift({id:'first-diamond',priority:20,maxActions:256,desired:{fact:'/inventory/minecraft:diamond',gte:1}});
  for(const block of['diamond_ore','deepslate_diamond_ore'])operators.push({id:'mine-'+block,cost:3,requires:{all:[{fact:'/world/nearbyBlocks/minecraft:'+block,eq:true},{any:['iron_pickaxe','diamond_pickaxe','netherite_pickaxe'].map(n=>({fact:'/inventory/minecraft:'+n,gte:1}))}]},action:{skill:'gather',args:{block:'minecraft:'+block,count:1}},effects:[{fact:'/inventory/minecraft:diamond',add:1}]});
  Object.assign(config,{name:release.name,worldId:runId,tickIntervalMs:200,actionTimeoutMs:20000});
  core=coreModule.createCore({config,adapter,planning:{operators,maxCalls:100000}});
 }else{
  catalog=coreModule.catalogFromMinecraftData(require('minecraft-data')('1.21.1'));
 }
 if(core)events(core);
};
const nativeSetup=async()=>{
 const module=await import(pathToFileURL(path.join(release.directory,'omconnect/index.js')));
 client=module.createOMConnect({host,port,username:release.name,version:'1.21.1',auth:'offline',viewDistance:8});
 client.on('warning',e=>{clip(errors,{at:Date.now(),reason:e.message},20);send('warning',{message:e.message});});
 client.on('drop',e=>{drops.set(String(e.id),{item:e.item?.name,position:{...e.position}});if(drops.size>2048)drops.delete(drops.keys().next().value);});
 client.on('collect',e=>{if(e.own){clip(pickups,{at:Date.now(),own:true,...drops.get(String(e.id))});sample();}});
 client.on('inventory',()=>sample());
 client.on('end',()=>{if(!ending){status='disconnected';reason||='Server disconnected client.';sample();void finish();}});
 await client.connect();if(client.recipeBook)await client.waitFor(()=>client.recipeBook.received,{event:'recipes',timeoutMs:12000});
 core=coreModule.createMinecraftBrain({client,worldId:runId,config:{tickIntervalMs:200,actionTimeoutMs:30000},storage:false,night:false,hunting:false,defense:{attackPlayers:false},survival:{targets:{'minecraft:diamond':1}}});
 events(core);
};
const legacy04Tick=async()=>{
 const inv=inventory();
 const ids=[...bot.findBlocks({matching:b=>/_log$|_stem$/.test(b.name),maxDistance:24,count:32}),...bot.findBlocks({matching:b=>/_ore$/.test(b.name),maxDistance:24,count:48}),...bot.findBlocks({matching:b=>/^(stone|deepslate|cobblestone)$/.test(b.name),maxDistance:24,count:32})];
 const found=new Map(ids.map(p=>{const b=bot.blockAt(p);return[b.name,b];}));
 const sources=[...found.values()].flatMap(b=>{const data=catalog.block('minecraft:'+b.name);return(data?.drops||[]).map(item=>({item,block:data.id,tools:data.harvestTools||[]}));});
 const stations={};
 for(const name of['crafting_table','furnace']){
  const existing=bot.findBlock({matching:b=>b.name===name,maxDistance:24});
  if(existing){stations['minecraft:'+name]=true;continue;}
  const p=bot.entity.position.floored();
  for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1],[2,0],[0,2]]){
   const pos=p.offset(dx,0,dz),b=bot.blockAt(pos),floor=bot.blockAt(pos.offset(0,-1,0));
   if(b?.name==='air'&&floor?.boundingBox==='block'&&!Object.values(stations).some(s=>s.x===pos.x&&s.z===pos.z)){stations['minecraft:'+name]={x:pos.x,y:pos.y,z:pos.z};break;}
  }
 }
 const stage=['crafting_table','wooden_pickaxe','stone_pickaxe','furnace','iron_pickaxe','diamond'].find(n=>!inv[n]&&stations['minecraft:'+n]!==true);
 if(!stage)return;
 const plan=coreModule.planResources({catalog,targets:{['minecraft:'+stage]:1},inventory:Object.fromEntries(Object.entries(inv).map(([n,v])=>['minecraft:'+n,v])),sources,stations,maxNodes:2000});
 reason=plan.reason;
 if(plan.status!=='planned'||!plan.actions.length){await delay(1000,undefined,{signal:controller.signal});return;}
 const workflow=coreModule.resourceWorkflow('resource', {...plan,actions:plan.actions.slice(0,64)});
 const resourceCore=coreModule.createCore({config:{schemaVersion:4,name:release.name,worldId:runId,actionTimeoutMs:25000,workflows:[workflow]},adapter});core=resourceCore;events(core);
 try{await core.tick();}finally{await core.stop();core=null;}
};
const help=async job=>{
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),before=inventory()[job.item]||0;
 if(before<job.count)throw new Error('Offer no longer available.');
 const p=position();if(Math.hypot(p.x-job.position.x,p.y-job.position.y,p.z-job.position.z)>20)throw new Error('Recipient moved beyond transfer radius.');
 const action={skill:'goto',args:{...job.position,range:1,timeoutMs:12000}};
 if(native){await client.execute(action,{signal});await client.execute({skill:'lookAtPlayer',args:{username:job.to,durationMs:200}},{signal});await client.execute({skill:'drop',args:{item:job.item,count:job.count}},{signal});}
 else{await adapter.execute(action,{signal});const recipient=bot.players[job.to]?.entity;if(!recipient||recipient.position.distanceTo(bot.entity.position)>4)throw new Error('Recipient not near donor.');await bot.lookAt(recipient.position.offset(0,1,0));const item=bot.inventory.items().find(i=>i.name===job.item);if(!item)throw new Error('Offer vanished.');await bot.toss(item.type,item.metadata,job.count);}
 send('transfer',{id:job.id,from:release.name,to:job.to,item:job.item,count:Math.max(0,before-(inventory()[job.item]||0)),position:position(),at:Date.now(),status:'dropped'});
};
async function loop(){
 try{while(!controller.signal.aborted&&status==='running'){
  if(transfer){const job=transfer;transfer=null;try{await help(job);}catch(e){send('transfer',{...job,at:Date.now(),status:'failed',reason:e.message});}}
  if(health()<=0){status='dead';break;}
  if(release.version==='0.4.0')await legacy04Tick();else await core.tick();loops++;sample();
  if(proof){status='finished';break;}
  await delay(200,undefined,{signal:controller.signal});
 }}catch(e){if(!ending){status='error';reason=e.message;send('warning',{message:e.message});}}
 finally{sample();if(status!=='running')await finish();}
}
async function finish(){
 if(ending)return;if(['running','armed','ready'].includes(status))status='stopped';sample();ending=true;controller.abort();clearInterval(sampler);
 try{await Promise.race([core?.stop(),delay(3500)]);}catch{}
 try{if(native){await Promise.race([client.close(),delay(2000)]);client.client?.socket?.destroy();}else{bot?.pathfinder?.setGoal(null);bot?.clearControlStates();bot?.quit();bot?._client?.socket?.destroy();}}catch{}
 ended=true;send('closed',{at:Date.now(),status});process.disconnect?.();setTimeout(()=>process.exit(0),50);
}
process.on('message',m=>{
 if(m.type==='start'&&!startedAt){startedAt=m.startedAt;status='armed';sampler=setInterval(sample,1000);void delay(Math.max(0,startedAt-Date.now())).then(()=>{if(!ending){status='running';send('started',{at:Date.now()});void loop();}});}
 if(m.type==='transfer'&&!transfer&&status==='running')transfer=m;
 if(m.type==='stop')void finish();
});
process.once('SIGINT',()=>void finish());process.once('SIGTERM',()=>void finish());
process.once('disconnect',()=>{if(!ended)void finish();});
try{
 await(native?nativeSetup():legacySetup());
 if(health()<=0)throw new Error('Spawned dead. Use a new race name.');
 if(!release.resume&&Object.keys(inventory()).length)throw new Error('Initial inventory is not empty. Use fresh names.');
 const gameMode=native?client.state.gameMode:bot.game.gameMode;
 if(gameMode!==0&&gameMode!=='survival')throw new Error('Benchmark requires survival mode; observed '+gameMode);
 status='ready';sample();send('ready',{version:coreModule.OVERMIND.version,transport:native?'omconnect':'mineflayer',capabilities:native?client.describe().skills:adapter.describe().skills,initial:{position:position(),health:health(),inventory:inventory(),gameMode}});
}catch(e){status='error';reason=e.message;send('fatal',{reason});await finish();}
