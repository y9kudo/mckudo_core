import {resourceId} from './catalog.js';

const base={night_vision:'golden_carrot',leaping:'rabbit_foot',fire_resistance:'magma_cream',swiftness:'sugar',water_breathing:'pufferfish',healing:'glistering_melon_slice',poison:'spider_eye',regeneration:'ghast_tear',strength:'blaze_powder',slowness:null,turtle_master:'turtle_helmet',slow_falling:'phantom_membrane',wind_charged:'breeze_rod',weaving:'cobweb',oozing:'slime_block',infested:'stone'};
const extendable=new Set(['night_vision','invisibility','leaping','fire_resistance','swiftness','slowness','water_breathing','poison','regeneration','strength','weakness','turtle_master','slow_falling']);
const amplifiable=new Set(['leaping','swiftness','slowness','healing','harming','poison','regeneration','strength','turtle_master']);
const corruption={night_vision:'invisibility',swiftness:'slowness',leaping:'slowness',healing:'harming',poison:'harming'};
const atLeast=(registry,minor)=>{const v=registry.version?.minecraftVersion||'1.21.1';return !v.startsWith('1.')||Number(v.split('.')[1])>=minor;};
/** Version-scoped brewing graph. Ingredients reference the connected registry. */
export function brewingRecipes(registry){
  const modern=atLeast(registry,21);
  const rows=[],exists=n=>Boolean(registry.itemsByName[n]);
  const add=(from,to,ingredient)=>{if(exists(ingredient))rows.push({from,to,ingredient:resourceId(ingredient),station:'minecraft:brewing_stand',fuel:'minecraft:blaze_powder',bottlesPerBatch:3,brewTicks:400});};
  add('water','awkward','nether_wart');add('water','weakness','fermented_spider_eye');
  for(const [potion,ingredient]of Object.entries(base))if(ingredient&&(modern||!['wind_charged','weaving','oozing','infested'].includes(potion)))add('awkward',potion,ingredient);
  for(const [from,to]of Object.entries(corruption))add(from,to,'fermented_spider_eye');
  const available=new Set(['water',...rows.map(r=>r.to)]);
  for(const p of extendable)if(available.has(p))add(p,'long_'+p,'redstone');
  for(const p of amplifiable)if(available.has(p))add(p,'strong_'+p,'glowstone_dust');
  for(const [from,to]of Object.entries(corruption)){
    if(extendable.has(from)&&extendable.has(to)&&available.has(from))add('long_'+from,'long_'+to,'fermented_spider_eye');
    if(['healing','poison'].includes(from)&&available.has(from))add('strong_'+from,'strong_'+to,'fermented_spider_eye');
  }
  return rows;
}
export function planBrewing({registry,potion,from='water',bottles=3,form='potion'}={}){
  if(typeof potion!=='string'||!Number.isInteger(bottles)||bottles<1||bottles>3||!['potion','splash_potion','lingering_potion'].includes(form))throw new Error("The plan for the potion: potion, bottles 1–3, form.");
  const recipes=brewingRecipes(registry),known=new Set(['water',...recipes.flatMap(r=>[r.from,r.to])]);
  if(!known.has(from)||!known.has(potion)||!registry.itemsByName[form])return {status:'blocked',reason:"No potion or shape in this version.",steps:[]};
  const queue=[{p:from,steps:[]}],seen=new Set([from]);let selected;
  while(queue.length){const current=queue.shift();if(current.p===potion){selected=current.steps;break;}for(const r of recipes.filter(r=>r.from===current.p)){if(seen.has(r.to))continue;seen.add(r.to);queue.push({p:r.to,steps:[...current.steps,r]});}}
  if(!selected)return {status:'blocked',reason:"No chain of potion in this version.",steps:[]};
  const steps=selected.map(r=>({...r,bottles}));
  if(form!=='potion')steps.push({from:potion,to:potion,ingredient:'minecraft:gunpowder',container:'splash_potion',bottles});
  if(form==='lingering_potion'){if(!registry.itemsByName.dragon_breath)return {status:'blocked',reason:"Not in this version dragon_breath.",steps:[]};steps.push({from:potion,to:potion,ingredient:'minecraft:dragon_breath',container:'lingering_potion',bottles});}
  const ingredients={};for(const s of steps)ingredients[s.ingredient]=(ingredients[s.ingredient]||0)+1;
  const version=registry.version?.minecraftVersion||'1.21.1',minor=Number(version.split('.')[1]);
  return {status:'planned',potion,form,bottles,steps,ingredients,fuel:{item:'minecraft:blaze_powder',count:version.startsWith('1.')&&minor<9?0:Math.ceil(steps.length/20)},station:'minecraft:brewing_stand',requiresExecutor:'brew'};
}
export function planNetheriteUpgrade({registry,item,inventory={}}={}){
  item=resourceId(item);const short=item.slice(10);
  if(!/^diamond_(helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel|hoe)$/.test(short))throw new Error("Diamond equipment is subject to improvement.");
  const output=short.replace('diamond_','netherite_');if(!registry.itemsByName[output])return {status:'unsupported',reason:"There is no non-zerite equipment in this version."};
  const required={[item]:1,'minecraft:netherite_ingot':1};if(atLeast(registry,20)&&registry.itemsByName.netherite_upgrade_smithing_template)required['minecraft:netherite_upgrade_smithing_template']=1;
  const missing=Object.fromEntries(Object.entries(required).map(([id,n])=>[id,Math.max(0,n-(inventory[id]||0))]).filter(([,n])=>n));
  return {status:Object.keys(missing).length?'needs-materials':'ready',station:'minecraft:smithing_table',input:item,output:resourceId(output),required,missing,preserveComponents:true,requiresExecutor:'smith'};
}
export function dimensionTravelPolicy(dimension){
  const policies={
    'minecraft:overworld':{coordinateScale:1,waterUsable:true,bedsUsable:true,maxDrop:16,avoid:['lava','powder_snow']},
    'minecraft:the_nether':{coordinateScale:8,waterUsable:false,bedsUsable:false,maxDrop:3,avoid:['lava','fire','magma_block'],ceilingSearch:true},
    'minecraft:the_end':{coordinateScale:1,waterUsable:true,bedsUsable:false,maxDrop:3,avoid:['void','dragon_breath'],bridgeNeedsKnownSupport:true}
  };if(!policies[dimension])throw new Error("Unknown dimension.");return structuredClone(policies[dimension]);
}
