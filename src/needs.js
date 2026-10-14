const safeFood=['cooked_beef','cooked_porkchop','cooked_mutton','cooked_salmon','cooked_chicken','bread','baked_potato','cooked_cod','apple','carrot','golden_carrot','beef','porkchop','mutton','golden_apple','enchanted_golden_apple'];
/** Food policy for native skills. Hunting excludes players, named and juvenile animals. */
export function createNeedsReactor({foodThreshold=16,allowHunting=true}={}){
  if(!Number.isInteger(foodThreshold)||foodThreshold<1||foodThreshold>20||typeof allowHunting!=='boolean')throw new Error("Uncorrect Feeding.");
  return {id:'overmind:needs',apiVersion:1,react(o){
    const healing=o.self?.health<=8&&['golden_apple','enchanted_golden_apple'].find(n=>o.inventory?.['minecraft:'+n]>0);
    if(healing)return {priority:900,action:{skill:'eat',args:{item:healing}},reason:"Re-establish critical health with a golden apple."};
    const recovering=Number.isFinite(o.self?.health)&&o.self.health<18,threshold=recovering?Math.max(18,foodThreshold):foodThreshold;
    if(o.self?.food==null||o.self.food>=threshold)return {action:null,reason:"Enough is enough."};
    const inv=o.inventory||{},food=safeFood.find(n=>inv['minecraft:'+n]>0);
    const action=(skill,args,reason,priority=60)=>({priority,action:{skill,args},reason});
    if(food)return action('eat',{item:food},"Re-establish sufficiency.",900);
    if(o.self.health<=6&&inv['minecraft:rotten_flesh']>0)return action('eat',{item:'rotten_flesh'},"Emergency recovery of critical health needs.",900);
    const raw=['chicken','rabbit','cod','salmon','potato'].find(n=>inv['minecraft:'+n]>0),fuel=['coal','charcoal'].find(n=>inv['minecraft:'+n]>0);
    if(raw&&fuel&&(inv['minecraft:furnace']||(o.world?.sampledBlocks||[]).some(b=>b.name==='minecraft:furnace')))return action('smelt',{item:raw==='potato'?'baked_potato':'cooked_'+raw,count:1,input:raw,fuel,gather:false},"Prepare Food.");
    if((o.drops||[]).some(d=>safeFood.some(f=>d.item==='minecraft:'+f)))return {action:null,reason:"First, pick up the observed food."};
    const p=o.self?.position,prey=allowHunting&&p&&(o.entities||[]).filter(e=>e.kind!=='player'&&['cow','pig','sheep','chicken','rabbit'].includes(e.name)&&e.isBaby!==true&&e.named!==true&&e.position).map(e=>({...e,d:Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)})).filter(e=>e.d<=12).sort((a,b)=>a.d-b.d)[0];
    return prey?action('combat',{entityId:prey.id,maxDistance:12,durationMs:400},"Get food from a observed animal."):{action:null,reason:"No observed safe food source."};
  }};
}
