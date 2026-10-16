const point = p => p && ['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const clean = name => String(name||'unknown').replace(/^minecraft:/,'').slice(0,100);
export function semanticCategories(name) {
  const n=clean(name),out=[];
  if(/(?:_log|_stem|_wood|_hyphae)$|^log2?$/.test(n))out.push('tree','logs');
  if(/leaves$|^leaves2?$/.test(n))out.push('tree','leaves');
  if(/_ore$|^ancient_debris$/.test(n))out.push('ores');
  if(/^deepslate_.*_ore$/.test(n))out.push('deepslate_ores');
  if(/(?:chest|barrel|shulker_box)$/.test(n))out.push('storage');
  if(/^(crafting_table|furnace|smoker|blast_furnace|brewing_stand|smithing_table)$/.test(n))out.push('workstation');
  if(/^(water|lava|fire|soul_fire|magma_block|cactus|sweet_berry_bush|powder_snow)$/.test(n))out.push('hazard');
  if(['arrow','spectral_arrow','trident','small_fireball','fireball'].includes(n))out.push('projectile');
  if(n==='player')out.push('player');
  if(n==='item')out.push('drop');
  return out.length?out:['other'];
}

/** Ephemeral evidence metadata. Neither saved hints nor aged positions become live world facts. */
export function createPerceptionTracker({maxEntities=512,maxChanges=128,clock=Date.now}={}) {
  for(const [name,n,min,max]of[['maxEntities',maxEntities,1,4096],['maxChanges',maxChanges,1,512]])if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid perception '+name+'.');
  if(typeof clock!=='function')throw new Error('Perception clock must be a function.');
  let scope=null,revision=0,received=0,coalesced=0,dropped=0;
  const entities=new Map(),changes=new Map();
  const event=(key,value)=>{
    received++;revision++;
    if(changes.has(key)){coalesced++;changes.delete(key);}
    changes.set(key,{revision,at:clock(),...value});
    while(changes.size>maxChanges){changes.delete(changes.keys().next().value);dropped++;}
  };
  const setScope=dimension=>{
    if(typeof dimension!=='string'||!dimension.length||dimension.length>128)throw new Error('Perception requires a dimension.');
    if(scope!==dimension){scope=dimension;entities.clear();changes.clear();event('scope',{type:'scope',dimension});}
  };
  return {
    setScope,
    observeEntity(entity,{dimension=scope,source='packet'}={}){
      setScope(dimension);if(!entity||!point(entity.position)||entity.id==null)return;
      const id=String(entity.id).slice(0,64),record={id,name:clean(entity.name),position:{...entity.position},observedAt:clock(),source:source==='cache'?'cache':'packet',categories:semanticCategories(entity.name)};
      entities.delete(id);entities.set(id,record);
      while(entities.size>maxEntities)entities.delete(entities.keys().next().value);
      event('entity:'+id,{type:'entity',id,name:record.name,position:record.position,categories:record.categories});
    },
    forgetEntity(id){id=String(id).slice(0,64);entities.delete(id);event('entity:'+id,{type:'entityGone',id});},
    observeBlock({position,name,stateId},dimension=scope){
      setScope(dimension);if(!point(position))return;
      const p=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(position[k])]));
      event('block:'+p.x+','+p.y+','+p.z,{type:'block',position:p,name:clean(name),stateId:Number.isInteger(stateId)?stateId:null,categories:semanticCategories(name)});
    },
    observeChunk({x,z},loaded,dimension=scope){setScope(dimension);if(!Number.isInteger(x)||!Number.isInteger(z))return;event('chunk:'+x+','+z,{type:loaded?'chunkLoad':'chunkUnload',x,z});},
    evidence(id){
      const e=entities.get(String(id));if(!e)return {source:'unknown',ageMs:null,confidence:0};
      const ageMs=Math.max(0,clock()-e.observedAt);
      return {source:e.source,ageMs,confidence:(e.source==='cache'?.8:1)*(ageMs<=1000?1:ageMs<=5000?.75:.5)};
    },
    snapshot({limit=Math.min(16,maxChanges)}={}){
      if(!Number.isInteger(limit)||limit<0||limit>maxChanges)throw new Error('Perception snapshot limit exceeds its budget.');
      return {schemaVersion:1,dimension:scope,revision,trackedEntities:entities.size,received,coalesced,dropped,changes:structuredClone(limit?[...changes.values()].slice(-limit):[])};
    },
    clear(){entities.clear();changes.clear();scope=null;}
  };
}
