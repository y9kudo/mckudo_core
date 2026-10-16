const rid=value=>{
  if(typeof value!=='string'||!/^(?:minecraft:)?[a-z0-9_]+$/.test(value))throw new Error('Team storage requires Minecraft item IDs.');
  return value.includes(':')?value:'minecraft:'+value;
};
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const tiers=['leather','wooden','golden','chainmail','stone','iron','diamond','netherite'];
const part=item=>item.match(/_(helmet|chestplate|leggings|boots|pickaxe|sword|axe|shovel|hoe)$/)?.[1];
const food=name=>/^(?:cooked_(?:beef|porkchop|mutton|chicken|rabbit|cod|salmon)|beef|porkchop|mutton|chicken|rabbit|cod|salmon|bread|apple|carrot|baked_potato|golden_carrot|sweet_berries|glow_berries)$/.test(name);
const group=name=>food(name)?'food':/^(?:coal|charcoal)$/.test(name)?'fuel':/(?:_log|_wood|_stem|_hyphae)$/.test(name)?'logs':/_planks$/.test(name)?'planks':/_bed$/.test(name)?'beds':null;
const sum=(counts,predicate)=>Object.entries(counts).reduce((total,[item,n])=>total+(predicate(item.slice(10))?n:0),0);

function owned(client){
  const result=Object.create(null),add=(item,n)=>{if(!Number.isInteger(n)||n<0||n>65536)throw new Error('Invalid observed inventory count.');const id=rid(item);result[id]=(result[id]||0)+n;};
  const inventory=client.inventory.snapshot();
  if(!inventory||Object.keys(inventory).length>256)throw new Error('Team inventory exceeds its item budget.');
  for(const [item,n]of Object.entries(inventory))add(item,n);
  for(const item of Object.values(client.inventory.equipment?.()||{}))if(item)add(item.item||item.name,item.count);
  const cursor=client.inventory.cursor;if(cursor)add(cursor.item||cursor.name,cursor.count);
  return result;
}

function demand(client,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>128)throw new Error('Storage targets require at most 128 item/class quantities.');
  const exact=Object.create(null),classes=[];let classMembers=0;
  for(const [key,n]of Object.entries(input)){
    if(!Number.isInteger(n)||n<0||n>4096)throw new Error('Storage targets: quantities 0–4096.');
    if(key.startsWith('#')){
      const names=key==='#planks'?client.registry?.itemsArray?.filter(i=>i.name.endsWith('_planks')).map(i=>i.name):client.world?.resolveSelectors?.([key]);
      if(!names||names.length>4096)throw new Error('Register the requested storage resource class: '+key);
      classMembers+=names.length;if(classes.length>=16||classMembers>4096)throw new Error('Storage class budget exceeded.');
      classes.push({members:new Set(names.map(rid)),count:n});
    }else{
      const id=rid(key);if(Object.hasOwn(exact,id))throw new Error('Duplicate storage target aliases.');exact[id]=n;
    }
  }
  return {exact,classes};
}

function target(item,member,defaults){
  const {counts,goals}=member,name=item.slice(10);
  if(Object.hasOwn(goals.exact,item))return goals.exact[item];
  let specified;
  for(const rule of goals.classes)if(rule.members.has(item)){
    const other=Object.entries(counts).reduce((n,[id,count])=>n+(id!==item&&rule.members.has(id)?count:0),0);
    specified=Math.max(specified??0,Math.max(0,rule.count-other));
  }
  if(specified!==undefined)return specified;
  if(!defaults)return 0;
  const family=part(name);
  if(family){
    const rank=tiers.indexOf(name.split('_')[0]);
    const better=Object.entries(counts).some(([id,n])=>n>0&&part(id.slice(10))===family&&tiers.indexOf(id.slice(10).split('_')[0])>=rank);
    return better?(counts[item]||0):1;
  }
  const category=group(name),limit={food:8,fuel:8,logs:4,planks:16,beds:1}[category];
  if(limit!==undefined)return Math.max(0,limit-sum(counts,n=>n!==name&&group(n)===category));
  return {shield:1,elytra:1,firework_rocket:16,arrow:16,spectral_arrow:16,stick:8,iron_ingot:8,crafting_table:1,furnace:1,water_bucket:1}[name]??(/^(?:cobblestone|cobbled_deepslate|dirt|netherrack|blackstone)$/.test(name)?16:0);
}

/** Discrete max-min filling, logarithmic in the largest requested quantity. */
function shares(stock,rows){
  const cost=level=>rows.reduce((n,r)=>n+Math.max(0,Math.min(r.target,level)-r.held),0);
  let low=0,high=Math.max(0,...rows.map(r=>r.target));
  while(low<high){const middle=Math.ceil((low+high)/2);if(cost(middle)<=stock)low=middle;else high=middle-1;}
  const amounts=rows.map(r=>Math.max(0,Math.min(r.target,low)-r.held));let left=stock-amounts.reduce((a,b)=>a+b,0);
  const order=rows.map((r,i)=>({i,name:r.name,level:r.held+amounts[i]})).filter(r=>rows[r.i].target>r.level).sort((a,b)=>a.level-b.level||(a.name<b.name?-1:1));
  for(const row of order){if(!left)break;amounts[row.i]++;left--;}
  return amounts;
}

/** Allocation policy only. Confirmed OMConnect window operations perform every transfer. */
export function createTeamStorageAllocator({worldId,clients,targets=()=>({}),defaults=true,maxDistance=32,clock=Date.now}={}){
  if(typeof worldId!=='string'||!worldId.trim()||worldId.length>128||!(Array.isArray(clients)||typeof clients==='function')||typeof targets!=='function'||typeof defaults!=='boolean'||!Number.isFinite(maxDistance)||maxDistance<1||maxDistance>128||typeof clock!=='function')throw new Error('Invalid team storage configuration.');
  const pool=()=>{
    const list=typeof clients==='function'?clients():clients;
    if(!Array.isArray(list)||list.length<1||list.length>20||list.some(c=>!c||typeof c.options?.username!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(c.options.username))||new Set(list.map(c=>c.options.username.toLowerCase())).size!==list.length)throw new Error('Team storage requires 1–20 unique clients.');
    return list;
  };
  if(Array.isArray(clients)){clients=[...clients];pool();}
  const last=new Map();let calls=0;
  const allocate=({agent,dimension,position,contents}={})=>{
    if(!point(position)||typeof dimension!=='string'||dimension.length>128||!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(dimension)||!Array.isArray(contents)||contents.length>128)throw new Error('Team storage requires bounded confirmed contents and a position.');
    const list=pool();if(!list.some(c=>c.options.username===agent))throw new Error('Unknown storage team member.');
    const members=list.filter(c=>c.state.status==='ready'&&c.state.health>0&&c.state.dimension===dimension&&point(c.state.position)&&Math.hypot(c.state.position.x-position.x-.5,c.state.position.y-position.y,c.state.position.z-position.z-.5)<=maxDistance)
      .map(c=>({name:c.options.username,counts:owned(c),goals:demand(c,targets(c))}));
    const self=members.findIndex(c=>c.name===agent);if(self<0)throw new Error('Storage requester is outside its eligible team scope.');
    const stock=Object.create(null),amounts=Object.create(null),remainingForTeam=Object.create(null);
    for(const item of contents){const id=rid(item.item||item.name);if(!Number.isInteger(item.count)||item.count<1||item.count>4096)throw new Error('Invalid confirmed storage quantity.');stock[id]=(stock[id]||0)+item.count;if(stock[id]>65536)throw new Error('Storage item budget exceeded.');}
    for(const item of Object.keys(stock).sort()){
      const rows=members.map(m=>({name:m.name,held:m.counts[item]||0,target:target(item,m,defaults)})),parts=shares(stock[item],rows);
      if(parts[self]>0)amounts[item]=parts[self];
      const other=parts.reduce((n,part,i)=>n+(i===self?0:part),0);if(other)remainingForTeam[item]=other;
      // Virtual grants prevent taking a separate full reserve of every wood/food variant.
      for(let i=0;i<members.length;i++)members[i].counts[item]=(members[i].counts[item]||0)+parts[i];
    }
    calls++;last.set(agent,{agent,at:clock(),dimension,position:{...position},members:members.map(m=>m.name),amounts:{...amounts},remainingForTeam:{...remainingForTeam}});
    if(last.size>20)last.delete(last.keys().next().value);
    return {...amounts};
  };
  return {worldId,policyId:'team-supplies',allocate,
    attach(client){
      const name=client.options?.username;if(!pool().some(c=>c.options.username===name))throw new Error('Unknown storage team member.');
      if(client.storagePolicy)throw new Error('Client already has a storage allocation policy.');
      let attached=true;const policy={id:'team-supplies',allocate:context=>{if(!attached)throw new Error('Storage allocation detached.');return allocate({...context,agent:name});}};
      client.storagePolicy=policy;return ()=>{if(!attached)return;attached=false;if(client.storagePolicy===policy)client.storagePolicy=undefined;last.delete(name);};
    },
    snapshot(){return {worldId,policyId:'team-supplies',calls,plans:structuredClone([...last.values()])};}
  };
}
