import {craftingRecipes} from './crafting.js';
const resource=s=>s?.startsWith('minecraft:')?s:'minecraft:'+s;
/** A per-connection recipe book. Packets are retained once; outputs indexed on demand. */
export class WorldRecipeBook {
  constructor(registry){this.registry=registry;this.received=false;this.revision=0;this.raw=[];this.cache=new Map();}
  ingest(packet){
    if(!Array.isArray(packet.recipes)||packet.recipes.length>20000)throw new Error("Uncorrect server recipe book.");
    this.raw=structuredClone(packet.recipes);this.versionCatalog=false;this.announcedHints=0;this.received=true;this.revision++;this.cache.clear();
  }
  useVersionCatalog(announced=0){this.versionCatalog=true;this.received=true;this.announcedHints=announced;this.revision++;this.cache.clear();}
  recipesFor(item){
    item=resource(item);if(this.cache.has(item))return structuredClone(this.cache.get(item));
    if(this.versionCatalog){
      const results=craftingRecipes(this.registry,item).map((r,index)=>{
        const groups=new Map(),cells=r.cells.map(cell=>({...cell,choices:cell.choices.map(resource)}));
        for(const cell of cells){const k=cell.choices.join('|');if(!groups.has(k))groups.set(k,{choices:cell.choices,count:0});groups.get(k).count++;}
        return {id:`omconnect:catalog/${item.replace(':','/')}/${index}`,type:'minecraft:crafting_shaped',output:{item,count:r.count},ingredients:[...groups.values()],station:r.table?'minecraft:crafting_table':null,executable:true,cells,reason:''};
      });this.cache.set(item,results);return structuredClone(results);
    }
    const results=[],items=this.registry.items;
    const ingredient=v=>(v||[]).map(s=>items[s.itemId]?.name).filter(Boolean).map(resource);
    for(const r of this.raw){
      const d=r.data;if(!d?.result||resource(items[d.result.itemId]?.name)!==item)continue;
      let groups=[],cells=[],station=null,executable=false;
      if(r.type==='minecraft:crafting_shaped'||r.type==='minecraft:crafting_shapeless'){
        const shaped=r.type.endsWith('_shaped'),raw=shaped?d.ingredients.flat():d.ingredients,width=shaped?(d.gridWidth??d.width):raw.length<=4?2:3,height=shaped?(d.gridHeight??d.height):Math.ceil(raw.length/width);
        if(width<1||width>3||height<1||height>3)continue;
        cells=raw.map((v,i)=>({x:i%width,y:Math.floor(i/width),choices:ingredient(v)})).filter(c=>c.choices.length);
        groups=cells.map(c=>({choices:c.choices,count:1}));station=width>2||height>2?'minecraft:crafting_table':null;executable=cells.length>0&&!cells.some(c=>c.choices.some(n=>/_bucket$|:honey_bottle$/.test(n)));
      }else if(['minecraft:smelting','minecraft:blasting','minecraft:smoking','minecraft:campfire_cooking','minecraft:stonecutting'].includes(r.type)){
        groups=[{choices:ingredient(d.ingredient),count:1}];station={'minecraft:smelting':'minecraft:furnace','minecraft:blasting':'minecraft:blast_furnace','minecraft:smoking':'minecraft:smoker','minecraft:campfire_cooking':'minecraft:campfire','minecraft:stonecutting':'minecraft:stonecutter'}[r.type];
      }else if(r.type==='minecraft:smithing_transform'){groups=['template','base','addition'].map(k=>({choices:ingredient(d[k]),count:1}));station='minecraft:smithing_table';}
      if(!groups.length||groups.some(g=>!g.choices.length))continue;
      const grouped=new Map();for(const g of groups){const key=[...g.choices].sort().join('|');if(!grouped.has(key))grouped.set(key,{choices:g.choices,count:0});grouped.get(key).count+=g.count;}groups=[...grouped.values()];
      results.push({id:r.name??r.recipeId,type:r.type,output:{item,count:d.result.itemCount},ingredients:groups,station,executable,cells,reason:executable?'':"We need a worker on the station."});
    }
    this.cache.set(item,results);return structuredClone(results);
  }
  snapshot(){return {source:this.versionCatalog?'version-catalog':this.received?'server':'waiting',revision:this.revision,announced:this.versionCatalog?this.announcedHints:this.raw.length,indexedOutputs:this.cache.size};}
}
