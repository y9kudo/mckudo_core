const safeFood=['cooked_beef','cooked_porkchop','cooked_mutton','cooked_salmon','cooked_chicken','bread','baked_potato','cooked_cod','apple','carrot','golden_carrot','beef','porkchop','mutton','golden_apple','enchanted_golden_apple'];
/** Food policy for native skills. Hunting excludes players, named and juvenile animals. */
export function createNeedsReactor({foodThreshold=16,allowHunting=true,client,clock=Date.now}={}){
  if(!Number.isInteger(foodThreshold)||foodThreshold<1||foodThreshold>20||typeof allowHunting!=='boolean')throw new Error("Uncorrect Feeding.");
  const failed=new Map();
  const actionKey=a=>JSON.stringify(a);
  const reactor={id:'overmind:needs',apiVersion:1,failureScope:'action',react(o){
    const healing=o.self?.health<=8&&['golden_apple','enchanted_golden_apple'].find(n=>o.inventory?.['minecraft:'+n]>0);
    if(healing)return {priority:900,action:{skill:'eat',args:{item:healing}},reason:"Re-establish critical health with a golden apple."};
    const recovering=Number.isFinite(o.self?.health)&&o.self.health<18,threshold=recovering?Math.max(18,foodThreshold):foodThreshold;
    if(o.self?.food==null||o.self.food>=threshold)return {action:null,reason:"Enough is enough."};
    const inv=o.inventory||{},food=safeFood.find(n=>inv['minecraft:'+n]>0);
    const action=(skill,args,reason,priority=60)=>({priority,action:{skill,args},reason});
    if(food)return action('eat',{item:food},"Re-establish sufficiency.",900);
    if(inv['minecraft:wheat']>=3)return action('craft',{item:'minecraft:bread',count:1},'Turn harvested wheat into bread.',900);
    if(o.self.health<=6&&inv['minecraft:rotten_flesh']>0)return action('eat',{item:'rotten_flesh'},"Emergency recovery of critical health needs.",900);
    const raw=['chicken','rabbit','cod','salmon','potato'].find(n=>inv['minecraft:'+n]>0),fuel=['coal','charcoal',...Object.keys(inv).filter(n=>n.endsWith('_planks')).map(n=>n.replace(/^minecraft:/,''))].find(n=>inv['minecraft:'+n]>0);
    if(raw&&fuel&&(inv['minecraft:furnace']||(o.world?.sampledBlocks||[]).some(b=>b.name==='minecraft:furnace')))return action('smelt',{item:raw==='potato'?'baked_potato':'cooked_'+raw,count:1,input:raw,fuel,gather:false},"Prepare Food.");
    if((o.drops||[]).some(d=>safeFood.some(f=>d.item==='minecraft:'+f)))return {action:null,reason:"First, pick up the observed food."};
    const p=o.self?.position,prey=allowHunting&&p&&(o.entities||[]).filter(e=>e.kind!=='player'&&['cow','pig','sheep','chicken','rabbit'].includes(e.name)&&e.isBaby!==true&&e.named!==true&&e.position&&e.visible!==false).map(e=>({...e,d:Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)})).filter(e=>e.d<=32).sort((a,b)=>a.d-b.d);
    for(const animal of prey||[]){
      const next=action('combat',{entityId:animal.id,maxDistance:32,durationMs:400,retreatHealth:0},'Obtain food from an observed adult animal.');
      if((failed.get(actionKey(next.action))??0)<=clock())return next;
    }
    const maturity={carrots:7,wheat:7,potatoes:7,beetroots:3};
    const crops=p?(o.world?.sampledBlocks??[]).filter(b=>Number(b.properties?.age)>=maturity[b.name.replace(/^minecraft:/,'')])
      .map(b=>({...b,d:Math.hypot(b.position.x-p.x,b.position.y-p.y,b.position.z-p.z)})).filter(b=>b.d<=128).sort((a,b)=>a.d-b.d):[];
    for(const crop of crops){
      if(client?.protection&&!client.protection.check({operation:'dig',dimension:o.dimension,position:crop.position,block:client.world.blockAt(crop.position),getBlock:q=>client.world.blockAt(q)}).allowed)continue;
      const next=action('dig',{...crop.position,block:crop.name},'Harvest an observed mature food crop; retain the farmland.');
      if((failed.get(actionKey(next.action))??0)<=clock())return next;
    }
    const emergency=['beetroot','potato'].find(n=>inv['minecraft:'+n]>0);
    if(emergency)return action('eat',{item:emergency},'Use available vegetables while seeking better food.',900);
    return {action:null,reason:'No observed safe food source.'};
  },attach(core){
    let active=null;
    const start=e=>{active=e.id===reactor.id?e.action:null;};
    const finish=e=>{if(e.rule===reactor.id&&active&&e.outcome==='failure'){failed.set(actionKey(active),clock()+15000);while(failed.size>128)failed.delete(failed.keys().next().value);}active=null;};
    core.on('action:start',start);core.on('action:finish',finish);return()=>{core.off('action:start',start);core.off('action:finish',finish);};
  }};return reactor;
}
