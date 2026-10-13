import {createKudoConnect,KUDOCONNECT} from '../kudoconnect/index.js';
import {createDragonPolicy,createCombatReactor,findLabelledStorage} from '../mckudo_core.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const client=createKudoConnect({host:process.env.MCKUDO_HOST||'127.0.0.1',port:Number(process.env.MCKUDO_PORT||25565),username:process.env.MCKUDO_NAME||'Avery07',version:'1.21.1',auth:'offline',viewDistance:12});
const minutesArg=process.argv.find(arg=>arg.startsWith('--minutes='));
const minutes=Number(minutesArg?.slice('--minutes='.length)??process.env.MCKUDO_END_MINUTES??20);
if(!Number.isFinite(minutes)||minutes<1||minutes>60)throw new Error('--minutes: 1–60.');
const report={version:KUDOCONNECT.version,stage:'preparing',status:'running',startedAt:new Date().toISOString(),actions:[],events:[]};
const event=(type,value={})=>{const e={at:new Date().toISOString(),type,...value};report.events.push(e);console.log(JSON.stringify(e));};
const save=async()=>{await mkdir('data',{recursive:true});await writeFile('data/end-v07-trial.json',JSON.stringify(report,null,2)+'\n');};
const doAction=async(skill,args={},priority=100)=>{
  const at=Date.now(),entry={skill,args,at:new Date().toISOString()};report.actions.push(entry);
  try{entry.result=await client.execute({skill,args},{priority});entry.outcome='success';}
  catch(error){entry.outcome='failure';entry.error=error.message;}
  entry.durationMs=Date.now()-at;entry.health=client.state.health;entry.position={...client.state.position};event('action',{skill,outcome:entry.outcome,error:entry.error,durationMs:entry.durationMs,health:entry.health,position:entry.position});await save();return entry;
};
for(const kind of ['crystalDestroyed','dragonDefeated','entityDead','death'])client.on(kind,data=>event(kind,{data}));
client.on('fallRescue',data=>event('fallRescue',data));
client.on('warning',error=>event('warning',{message:error.message}));
const defense=createCombatReactor({pathRetreat:true});let urgent=null;
client.on('damage',damage=>{
  if(damage.entityId!==String(client.state.entityId)||client.entities.get(Number(damage.sourceId))?.name!=='enderman'||urgent)return;
  urgent=(async()=>{
    for(let i=0;i<5&&client.state.status==='ready';i++){
      const decision=defense.react(client.observe());if(!decision.action)break;
      const action=decision.action;event('enderman-defense',{skill:action.skill,reason:decision.reason,entityId:action.args?.entityId});
      const result=await doAction(action.skill,action.args,Math.max(1100,decision.priority||0));defense.recordResult({outcome:result.outcome},action);
      if(result.outcome==='failure')break;
    }
  })().catch(error=>event('enderman-defense-error',{message:error.message})).finally(()=>{urgent=null;});
});
try{
  await client.connect();if(client.snapshot().identity.version!==report.version)throw new Error('Версия клиента не совпадает с версией испытания.');
  if(client.state.status==='dead')throw new Error('Агент мёртв: возроди и телепортируй его в End перед новым прогоном.');
  if(client.state.dimension!=='minecraft:the_end')throw new Error('Агент не в Энде.');
  await delay(750);report.initial=client.snapshot();
  const equipped=['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots'].every(n=>client.inventory.ownedCount(n)>0);
  const supplied=equipped&&client.inventory.count('bow')>0&&client.inventory.count('arrow')>=32&&client.inventory.count('end_stone')>=32&&client.inventory.count('water_bucket')>0&&client.inventory.count('ender_pearl')>=8;
  if(!supplied){
  const chest=findLabelledStorage(client,'Снаряжение',{radius:24});report.chest=chest;
  const contents=await doAction('inspectStorage',chest);
  if(contents.outcome!=='success')throw new Error(contents.error);
  const stock=Object.fromEntries(contents.result.contents.map(i=>[i.name,(contents.result.contents.filter(j=>j.name===i.name).reduce((n,j)=>n+j.count,0))]));report.stock=stock;
  const required=['bow','arrow','netherite_sword','netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots','end_stone','water_bucket','ender_pearl'];
  const missing=required.filter(n=>!stock[n]&&!client.inventory.ownedCount(n));report.missing=missing;if(missing.length&&!process.argv.includes('--prepare'))throw new Error('В сундуке нет: '+missing.join(', '));
  const amounts={};
  for(const [name,want] of Object.entries({bow:1,arrow:128,netherite_sword:1,netherite_helmet:1,netherite_chestplate:1,netherite_leggings:1,netherite_boots:1,netherite_pickaxe:1,shield:1,end_stone:128,golden_apple:16,water_bucket:1,ender_pearl:16,totem_of_undying:1})){
    const need=Math.min(stock[name]||0,Math.max(0,want-client.inventory.ownedCount(name)));if(need)amounts[name]=need;
  }
  if(Object.keys(amounts).length){const take=await doAction('takeStorage',{...chest,amounts});if(take.outcome!=='success')throw new Error(take.error);}
  for(const item of ['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots']){
    if(!client.inventory.ownedCount(item)&&process.argv.includes('--prepare'))continue;
    const e=await doAction('equipArmor',{item});if(e.outcome!=='success')throw new Error(e.error);
  }
  }
  report.prepared=client.snapshot();event('prepared',{position:client.state.position,health:client.state.health,inventory:client.inventory.snapshot(),equipment:client.inventory.equipment()});
  if(process.argv.includes('--prepare')){report.status=report.missing?.length?'prepared-partial':'prepared';report.stage='prepared';}
  else{
    report.stage='dragon';const policy=createDragonPolicy({client});
    const deadline=Date.now()+minutes*60000;let idle=0,failed=0;
    while(Date.now()<deadline&&client.state.status==='ready'&&!client.connectionAbort.signal.aborted&&!client.endgame.dragonDeath?.confirmed){
      if(client.fallSafety.active){await client.fallSafety.active;continue;}
      if(urgent){await urgent;continue;}
      const protection=defense.react(client.observe());
      if(protection.action){const action=protection.action;const result=await doAction(action.skill,action.args,protection.priority);defense.recordResult({outcome:result.outcome},action);continue;}
      if(client.state.health<=14&&client.inventory.count('golden_apple')>0){const eat=await doAction('eat',{item:'golden_apple'},1000);if(eat.outcome==='success'){failed=0;continue;}}
      const decision=policy.react({...client.observe(),dimension:client.state.dimension});
      if(!decision?.action){idle++;if(idle>30)break;await delay(400);continue;}
      idle=0;const {skill,args}=decision.action;event('decision',{skill,reason:decision.reason});
      const result=await doAction(skill,args,decision.priority||100);policy.recordResult({outcome:result.outcome,detail:result.error||''},decision.action);
      if(result.outcome==='failure'){failed++;if(failed>=10)break;await delay(Math.min(2000,failed*250));}else failed=0;
    }
    report.dragonPolicy=policy.snapshot();report.status=client.endgame.dragonDeath?.confirmed?'dragon-defeated':client.state.status==='dead'?'dead':'incomplete';
  }
}catch(error){report.status='failed';report.error=error.message;console.error(error.stack);process.exitCode=1;}
finally{report.final=client.snapshot();report.endgame=structuredClone(client.endgame);report.finishedAt=new Date().toISOString();await save();await client.close();console.log(JSON.stringify({status:report.status,stage:report.stage,error:report.error,actions:report.actions.length,crystals:report.endgame.crystals?.length||0,dragon:report.endgame.dragonDeath||null}));}
