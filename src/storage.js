/** OvermindMC storage policy. OMConnect owns only the confirmed physical actions. */
export const STORAGE_CATEGORIES=Object.freeze({building:"Construction",resources:"Materials",equipment:"Equipment",food:"Food",nature:"Plants and Droop",other:"Miscellaneous"});
export function storageCategory(item,registry){
  const n=(typeof item==='string'?item:item.name||item.item).replace(/^minecraft:/,'');
  if(registry?.foodsByName?.[n]||/^(cake|suspicious_stew|mushroom_stew|rabbit_stew|honey_bottle|milk_bucket)$/.test(n))return 'food';
  if(/_(helmet|chestplate|leggings|boots|sword|axe|pickaxe|shovel|hoe)$/.test(n)||/^(elytra|bow|crossbow|trident|shield|mace|fishing_rod|flint_and_steel|shears)$/.test(n))return 'equipment';
  if(/_(ore|ingot|nugget|scrap)$/.test(n)||/^(ancient_debris|diamond|emerald|coal|charcoal|raw_iron|raw_copper|raw_gold|quartz|lapis_lazuli|redstone|amethyst_shard|prismarine_crystals|prismarine_shard|clay_ball|flint|blaze_rod|blaze_powder|ender_pearl|ender_eye|heart_of_the_sea)$/.test(n))return 'resources';
  if(/_(seeds|sapling|flower|leaves|dye)$/.test(n)||/^(feather|string|leather|bone|bone_meal|rotten_flesh|spider_eye|slime_ball|nautilus_shell|wheat|sugar_cane|bamboo|kelp|nether_wart|flowering_azalea|azalea|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|lily_of_the_valley|wither_rose|torchflower|pink_petals|lily_pad|cactus|vine|brown_mushroom|red_mushroom)$/.test(n))return 'nature';
  if(/_sign$/.test(n)||/^(stick|music_disc_.*|painting|item_frame|glow_item_frame|firework_rocket|firework_star|book|written_book|writable_book|map|filled_map|compass|clock|name_tag|saddle|lead)$/.test(n))return 'other';
  return registry?.blocksByName?.[n]?'building':'other';
}
export function storageForSign(client,sign){
  const b=client.world.blockAt(sign.position),face=b?.getProperties?.().facing;
  const delta={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]}[face];
  if(b?.name?.endsWith('_wall_sign')&&delta)return {x:sign.position.x-delta[0],y:sign.position.y,z:sign.position.z-delta[1]};
  const below={...sign.position,y:sign.position.y-1};
  if(/^(chest|trapped_chest|barrel|(?:[a-z_]+_)?shulker_box)$/.test(client.world.blockAt(below)?.name||''))return below;
  const all=[[-1,0],[1,0],[0,-1],[0,1]].map(([x,z])=>({x:sign.position.x+x,y:sign.position.y,z:sign.position.z+z})).filter(p=>/^(chest|trapped_chest|barrel|(?:[a-z_]+_)?shulker_box)$/.test(client.world.blockAt(p)?.name||''));
  if(all.length!==1)throw new Error("The tablet is mixed in the vault.");return all[0];
}
export function findLabelledStorage(client,label,{radius=96}={}){
  if(typeof label!=='string'||!label.trim())throw new Error("Need a storage mark.");
  const signs=client.findSigns({text:label,radius}).filter(s=>[...s.front,...s.back].some(t=>t.toLowerCase()===label.toLowerCase()));
  if(signs.length!==1)throw new Error(`Sign «${label}»: found ${signs.length}, One is required.`);
  return storageForSign(client,signs[0]);
}
const sum=items=>{const result={};for(const i of items)result[i.item]=(result[i.item]||0)+i.count;return result;};

/** Explicit warehouse job; does not run the opportunistic looting reactor. */
export async function sortStorage(client,{source,sourceLabel='Random',radius=32,destinations,maxBatches=16,resumeInventory=false,preserveItems=[],signal,onProgress}={}){
  if(!Number.isInteger(radius)||radius<4||radius>128||!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>64)throw new Error('sortStorage: radius 4–128, maxBatches 1–64.');
  signal?.throwIfAborted();source??=findLabelledStorage(client,sourceLabel,{radius:128});
  const execute=(skill,args)=>client.execute({skill,args},{signal});
  const report={status:'running',source,assignments:{},transferred:[],labels:[],batches:0};
  const progress=()=>onProgress?.(structuredClone(report));
  if(!Array.isArray(preserveItems)||preserveItems.some(s=>typeof s!=='string')||typeof resumeInventory!=='boolean')throw new Error("resumeInventory: boolean, preserveItems: list ID.");
  const recovered=resumeInventory?client.inventory.items().filter(i=>!preserveItems.some(n=>n.replace(/^minecraft:/,'')===i.name)):[];
  const initial=await execute('inspectStorage',source),categories=[...new Set([...initial.contents,...recovered].map(i=>storageCategory(i,client.registry)))].sort();
  let initialCounts=sum(initial.contents);
  if(!categories.length)return {...report,status:'completed',sourceEmpty:true,serverConfirmed:true};
  const found=(await client.findStorages({radius:128,count:64,signal})).storages.filter(s=>s.key!==initial.identity.key&&Math.hypot(s.position.x-source.x,s.position.y-source.y,s.position.z-source.z)<=radius);
  const signs=client.findSigns({radius:128});
  const candidates=[];
  for(const s of found){
    const attached=signs.filter(sign=>{try{return s.positions.some(p=>JSON.stringify(p)===JSON.stringify(storageForSign(client,sign)));}catch{return false;}});
    const own=attached.find(s=>s.front[1]==='OvermindMC'),existingCategory=own?Object.keys(STORAGE_CATEGORIES).find(k=>STORAGE_CATEGORIES[k]===own.front[0]):null;
    // Never reuse a chest with a user's nonempty label (including Elytra).
    if(attached.some(s=>[...s.front,...s.back].some(Boolean))&&!existingCategory)continue;
    try{const state=await execute('inspectStorage',s.position);if(!state.contents.length||existingCategory&&state.contents.every(i=>storageCategory(i,client.registry)===existingCategory))candidates.push({...s,existingCategory,contents:state.contents,sign:own});}catch(e){signal?.throwIfAborted();onProgress?.({status:'unreachable-storage',position:s.position,error:e.message});}
  }
  const used=new Set();
  for(const category of categories){
    const requested=destinations?.[category],s=requested?candidates.find(s=>s.positions.some(p=>['x','y','z'].every(k=>p[k]===requested[k]))):candidates.find(s=>s.existingCategory===category&&!used.has(s.key))||candidates.find(s=>!s.existingCategory&&!used.has(s.key));
    if(!s||!candidates.some(c=>c.key===s.key)||used.has(s.key))throw new Error(`For category ${STORAGE_CATEGORIES[category]} No separate empty storage facility. Requires ${categories.length}.`);
    used.add(s.key);report.assignments[category]=s.position;
  }
  initialCounts=sum([...initial.contents,...recovered,...candidates.filter(s=>used.has(s.key)).flatMap(s=>s.contents)]);
  // Acquire exactly the label budget, leaving unrelated inventory untouched.
  const signItem=client.inventory.items().find(i=>/_sign$/.test(i.name)&&!i.name.includes('hanging'))?.name||initial.contents.find(i=>/_sign$/.test(i.name)&&!i.name.includes('hanging'))?.name;
  if(!signItem)throw new Error("You need wooden signs for signatures; Put them in the original chest or agent's equipment.");
  const labelsNeeded=candidates.filter(s=>used.has(s.key)&&!s.existingCategory).length,signsBefore=client.inventory.count(signItem),needed=Math.max(0,labelsNeeded-signsBefore);
  if(needed){const r=await execute('takeStorage',{...source,amounts:{[signItem]:needed}});if(r.transferred.reduce((n,i)=>n+i.count,0)!==needed)throw new Error("Missing plates for all categories.");}
  for(const category of categories){report.labels.push(await execute('labelStorage',{...report.assignments[category],lines:[STORAGE_CATEGORIES[category],'OvermindMC','0.7']}));progress();}
  const deposit=async items=>{
    const byCategory={};for(const i of items){const category=storageCategory(i.item,client.registry);byCategory[category]??={};byCategory[category][i.item]=(byCategory[category][i.item]||0)+i.count;}
    for(const [category,amounts] of Object.entries(byCategory)){
      if(!report.assignments[category])throw new Error("The composition of the original chest has changed: new category.");
      const result=await execute('depositStorage',{...report.assignments[category],amounts,maxStacks:54});
      const counts=sum(result.transferred);if(Object.entries(amounts).some(([id,n])=>counts[id]!==n))throw new Error("Target chest filled; Some items remained with the agent.");
      report.transferred.push({category,items:result.transferred});
    }
  };
  if(recovered.length){await deposit(recovered);progress();}
  for(let batch=0;batch<maxBatches;batch++){
    const state=await execute('inspectStorage',source);if(!state.contents.length)break;
    const requests=sum(state.contents);for(const [name,n] of Object.entries(requests))requests[name]=Math.min(4096,n);
    const taken=await execute('takeStorage',{...source,amounts:requests,maxStacks:32});
    if(!taken.transferred.length)throw new Error("Inventory is full: No progress in warehousing.");
    await deposit(taken.transferred);
    report.batches++;progress();
  }
  const final=await execute('inspectStorage',source),observed=[];
  for(const [category,position] of Object.entries(report.assignments)){
    const state=await execute('inspectStorage',position);
    if(state.contents.some(i=>storageCategory(i,client.registry)!==category))throw new Error("The final check revealed a confusion of categories.");
    observed.push(...state.contents);
  }
  const counts=sum([...final.contents,...observed]);
  // Signs consumed by this job are the sole intentional item conversion.
  counts['minecraft:'+signItem]=(counts['minecraft:'+signItem]||0)+needed;
  const conserved=Object.keys({...initialCounts,...counts}).every(id=>counts[id]===initialCounts[id]);
  if(!conserved)throw new Error("The totals did not match the original quantities: Re-observation required.");
  return {...report,status:final.contents.length?'incomplete':'completed',sourceEmpty:!final.contents.length,serverConfirmed:true,conserved,initialCounts,finalCounts:sum(observed)};
}
