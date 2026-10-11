const colors=['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const drops={cow:['beef','leather'],mooshroom:['beef','leather'],pig:['porkchop'],sheep:['mutton'],chicken:['chicken','feather'],rabbit:['rabbit','rabbit_hide']};
/** Hunt observed adults only while there is a resource/food deficit. Drops remain server-owned. */
export function createHuntingReactor({targets={leather:4},foodReserve=6,radius=24,prepareWool=true,reserveRequiresTools=true,maxPursuitMs=15000,clock=Date.now}={}){
  if(!Number.isInteger(foodReserve)||foodReserve<0||foodReserve>64||!Number.isFinite(radius)||radius<1||radius>32||!targets||Object.entries(targets).some(([n,c])=>!(/^(minecraft:)?[a-z0-9_]+$/).test(n)||!Number.isInteger(c)||c<0||c>256))throw new Error('Неверные параметры охоты.');
  if(!Number.isInteger(maxPursuitMs)||maxPursuitMs<2000||maxPursuitMs>60000)throw new Error('maxPursuitMs: 2000–60000.');
  if(typeof reserveRequiresTools!=='boolean')throw new Error('reserveRequiresTools: true или false.');
  const blocked=new Map();let selected=null,pursuit=null;
  const reactor={id:'mckudo:hunting',apiVersion:1,react(o){
    selected=null;for(const [id,until]of blocked)if(until<=clock())blocked.delete(id);
    if(!o.self?.position||o.self.health<=8||o.self.freeInventorySlots===0)return {action:null,reason:'Охота сейчас небезопасна.'};
    const inv=o.inventory||{},count=n=>inv['minecraft:'+n]||0,needed=Object.entries(targets).filter(([n,c])=>count(n.replace(/^minecraft:/,''))<c).map(([n])=>n.replace(/^minecraft:/,''));
    const food=Object.entries(inv).reduce((sum,[n,c])=>sum+(/^(minecraft:)?(cooked_.*|beef|porkchop|mutton|chicken|rabbit|bread|apple)$/.test(n)?c:0),0);
    const hasTool=Object.entries(inv).some(([n,c])=>c>0&&/_(sword|axe|pickaxe)$/.test(n));
    const huntForReserve=!reserveRequiresTools||hasTool||(o.self.food??20)<14;
    if(food<foodReserve&&huntForReserve)needed.push('beef','porkchop','mutton','chicken','rabbit');
    const wool=colors.map((color,index)=>({color,index,count:count(color+'_wool')})).sort((a,b)=>b.count-a.count),bed=Object.entries(inv).some(([n,c])=>c>0&&n.endsWith('_bed'))||(o.world?.sampledBlocks||[]).some(b=>b.name.endsWith('_bed'));
    if(prepareWool&&!bed&&wool[0].count<3)needed.push(...wool.filter(w=>wool[0].count===0||w.index===wool[0].index).map(w=>w.color+'_wool'));
    const candidates=(o.entities||[]).filter(e=>e.kind!=='player'&&e.visible!==false&&!e.isBaby&&!e.named&&e.position&&drops[e.name]).map(e=>({...e,d:Math.hypot(e.position.x-o.self.position.x,e.position.y-o.self.position.y,e.position.z-o.self.position.z),outputs:[...drops[e.name],...(e.name==='sheep'&&!e.sheared&&Number.isInteger(e.woolColor)?[colors[e.woolColor]+'_wool']:[])]})).filter(e=>e.d<=radius&&e.outputs.some(n=>needed.includes(n))).sort((a,b)=>a.d-b.d);
    if(pursuit&&clock()-pursuit.since>=maxPursuitMs){blocked.set(pursuit.id,clock()+15000);pursuit=null;if(blocked.size>128)blocked.delete(blocked.keys().next().value);}
    const prey=candidates.find(e=>!blocked.has(String(e.id)));
    if(!prey)return {action:null,reason:'Нет дефицита или подходящих наблюдаемых животных.'};
    selected=String(prey.id);
    if(pursuit?.id!==selected)pursuit={id:selected,since:clock()};
    const action=prey.d>2.8?{skill:'navigate',args:{x:Math.floor(prey.position.x),y:Math.floor(prey.position.y),z:Math.floor(prey.position.z),range:1,bridge:false,sprintJump:false}}:{skill:'combat',args:{entityId:prey.id,maxDistance:radius,durationMs:600}};
    return {priority:40,action,reason:`Добыть нужные ресурсы: ${prey.outputs.filter(n=>needed.includes(n)).join(', ')}.`};
  },attach(core){
    let active=null;
    const start=e=>{if(e.id===reactor.id)active=selected;};
    const finish=e=>{if(e.rule!==reactor.id)return;if(e.outcome==='failure'&&active){blocked.set(active,clock()+10000);if(blocked.size>128)blocked.delete(blocked.keys().next().value);}active=null;};
    core.on('action:start',start);core.on('action:finish',finish);return()=>{core.off('action:start',start);core.off('action:finish',finish);};
  }};return reactor;
}
