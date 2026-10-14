import { jsonCopy, object } from './config.js';

export const resourceId = name => {
  if (typeof name !== 'string') throw new Error("I need a line ID Resource.");
  const value = name.includes(':') ? name : 'minecraft:' + name;
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) throw new Error(`Invalid ID: ${name}`);
  return value;
};
const clone = value => jsonCopy(value, '$catalog', 32 * 1024 * 1024);
const resultOf = r => typeof r === 'string' ? { item: resourceId(r), count: 1 } : r?.id || r?.item ? { item: resourceId(r.id || r.item), count: r.count ?? 1 } : null;

/** Import every record; dynamic/special recipes remain indexed with executable=false. */
export function importVanillaRecipes(input, tags = {}) {
  const recipes = clone(input), tagData = clone(tags);
  const resolveTag = (name, stack = []) => {
    name = resourceId(name);
    if (stack.includes(name) || stack.length > 32) throw new Error(`Tag Cycle: ${name}`);
    const tag = tagData[name]; if (!tag) throw new Error(`Unknown tag: ${name}`);
    return [...new Set((tag.values || tag).flatMap(v => {
      const entry = typeof v === 'string' ? v : v.id;
      if (entry?.startsWith('#')) {
        if (v.required === false && !tagData[resourceId(entry.slice(1))]) return [];
        return resolveTag(entry.slice(1), [...stack, name]);
      }
      return [resourceId(entry)];
    }))];
  };
  const ingredient = value => {
    if (Array.isArray(value)) return [...new Set(value.flatMap(ingredient))];
    if (typeof value === 'string') return value.startsWith('#') ? resolveTag(value.slice(1)) : [resourceId(value)];
    if (value?.item) return [resourceId(value.item)];
    if (value?.tag) return resolveTag(value.tag);
    throw new Error("Non-supported ingredient.");
  };
  return Object.entries(recipes).map(([name, raw]) => {
    const record = { id: resourceId(name), type: resourceId(raw.type), output: resultOf(raw.result), ingredients: [], station: null, executable: false, reason: '', raw };
    try {
      let slots = [];
      if (raw.type === 'minecraft:crafting_shaped') {
        if (!Array.isArray(raw.pattern)) throw new Error("No pattern.");
        slots = raw.pattern.flatMap(row => [...row].filter(c => c !== ' ').map(c => ingredient(raw.key[c])));
        record.station = raw.pattern.length > 2 || raw.pattern.some(r => r.length > 2) ? 'minecraft:crafting_table' : null;
      } else if (raw.type === 'minecraft:crafting_shapeless') {
        slots = raw.ingredients.map(ingredient); record.station = slots.length > 4 ? 'minecraft:crafting_table' : null;
      } else if (['minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking', 'minecraft:campfire_cooking', 'minecraft:stonecutting'].includes(raw.type)) {
        slots = [ingredient(raw.ingredient)];
        record.station = { 'minecraft:smelting': 'minecraft:furnace', 'minecraft:blasting': 'minecraft:blast_furnace', 'minecraft:smoking': 'minecraft:smoker', 'minecraft:campfire_cooking': 'minecraft:campfire', 'minecraft:stonecutting': 'minecraft:stonecutter' }[raw.type];
        record.cookingTime = raw.cookingtime ?? 0;
      } else throw new Error("Dynamic or special recipe: Need a separate performer.");
      const grouped = new Map();
      for (const choices of slots) {
        if (!choices.length) throw new Error("An empty ingredient tag.");
        const key = [...choices].sort().join('|');
        if (!grouped.has(key)) grouped.set(key, { choices: [...choices].sort(), count: 0 });
        grouped.get(key).count++;
      }
      record.ingredients = [...grouped.values()];
      record.executable = Boolean(record.output) && ['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:smelting', 'minecraft:smoking', 'minecraft:blasting'].includes(raw.type);
      if (!record.executable) record.reason = "The recipe is indexed; This type of performer is not yet connected.";
    } catch (error) { record.reason = String(error.message).slice(0, 300); }
    return record;
  });
}

export function createCatalog({ version, items, blocks, recipes = [] }) {
  if (typeof version !== 'string' || !version || version.length > 64) throw new Error("Catalogue needs a version Minecraft.");
  if (![items, blocks, recipes].every(Array.isArray) || items.length > 50000 || blocks.length > 50000 || recipes.length > 100000) throw new Error("Catalogue: Mislists or excess of recording limits.");
  const index = list => {
    const map = new Map();
    for (const raw of clone(list)) {
      const entry = { ...raw, id: resourceId(raw.id) };
      if (map.has(entry.id)) throw new Error(`Retry ID: ${entry.id}`);
      map.set(entry.id, entry);
    }
    return map;
  };
  const itemMap = index(items), blockMap = index(blocks), recipeMap = index(recipes), byOutput = new Map();
  for (const r of recipeMap.values()) {
    if (!r.output) continue;
    if (!itemMap.has(r.output.item) || !Number.isInteger(r.output.count) || r.output.count < 1 || r.output.count > 64) throw new Error(`Misdue result of the recipe ${r.id}.`);
    if (!Array.isArray(r.ingredients)) throw new Error("The recipe is needed ingredients.");
    for (const g of r.ingredients) if (!object(g) || !Number.isInteger(g.count) || g.count < 1 || !Array.isArray(g.choices) || !g.choices.length || g.choices.some(i => !itemMap.has(i))) throw new Error(`Unknown ingredient ${r.id}.`);
    if (!byOutput.has(r.output.item)) byOutput.set(r.output.item, []);
    byOutput.get(r.output.item).push(r);
  }
  const get = (map, name) => { const value = map.get(resourceId(name)); return value ? clone(value) : null; };
  return Object.freeze({ version,
    item: name => get(itemMap, name), block: name => get(blockMap, name), recipe: name => get(recipeMap, name),
    recipesFor: name => clone(byOutput.get(resourceId(name)) || []),
    items: () => clone([...itemMap.values()]), blocks: () => clone([...blockMap.values()]), recipes: () => clone([...recipeMap.values()]),
    summary: () => ({ version, items: itemMap.size, blocks: blockMap.size, recipes: recipeMap.size, executableRecipes: [...recipeMap.values()].filter(r => r.executable).length,
      types: [...recipeMap.values()].reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {}) })
  });
}

/** Adapter-side import: the caller supplies minecraft-data or bot.registry. No dependency in the kernel. */
export function catalogFromMinecraftData(data, { vanillaRecipes, tags, recipeBook } = {}) {
  const itemNames = new Map(data.itemsArray.map(i => [i.id, resourceId(i.name)]));
  const items = data.itemsArray.map(i => ({ id: resourceId(i.name), numericId: i.id, displayName: i.displayName, stackSize: i.stackSize ?? 64, maxDurability: i.maxDurability ?? null }));
  const blocks = data.blocksArray.map(b => ({ id: resourceId(b.name), numericId: b.id, displayName: b.displayName, hardness: b.hardness ?? null,
    diggable: b.diggable ?? false, boundingBox: b.boundingBox ?? null, drops: (b.drops || []).map(id => itemNames.get(typeof id === 'object' ? id.id : id)).filter(Boolean),
    harvestTools: Object.keys(b.harvestTools || {}).map(id => itemNames.get(Number(id))).filter(Boolean), states: b.states || [] }));
  let recipes;
  if(recipeBook){
    const base=createCatalog({version:data.version.minecraftVersion,items,blocks,recipes:[]});
    return Object.freeze({...base,recipesFor:name=>recipeBook.recipesFor(resourceId(name)),
      recipes:()=>{throw new Error("The World Book is indexed on demand: Use it recipesFor(item).");},
      summary:()=>({...base.summary(),recipeBook:recipeBook.snapshot()})});
  }
  if (vanillaRecipes) recipes = importVanillaRecipes(vanillaRecipes, tags);
  else recipes = Object.entries(data.recipes || {}).flatMap(([out, variants]) => variants.map((r, n) => {
    const recipeId=`overmind:craft/${out}/${n}`,values=r.inShape?.flat()||r.ingredients||[],missing=[...new Set([...values.map(v=>typeof v==='object'&&v!==null?v.id:v),r.result?.id].filter(id=>id!=null&&id>=0&&!itemNames.has(id)))];
    if(missing.length)return {id:recipeId,type:r.inShape?'minecraft:crafting_shaped':'minecraft:crafting_shapeless',output:itemNames.has(r.result?.id)?{item:itemNames.get(r.result.id),count:r.result.count}:null,ingredients:[],station:null,executable:false,reason:`Registry has no item for recipe IDs: ${missing.join(', ')}. A version-specific item mapping is required.`,raw:clone(r)};
    const counts = new Map();
    for (const value of r.inShape?.flat() || r.ingredients || []) {
      const numericId = typeof value === 'object' && value !== null ? value.id : value;
      if (numericId == null || numericId < 0) continue;
      const item = itemNames.get(numericId); if (!item) throw new Error(`No item ID ${numericId}.`);
      counts.set(item, (counts.get(item) || 0) + (typeof value === 'object' ? value.count ?? 1 : 1));
    }
    const hasReturns = Boolean(r.outShape || r.outIngredients);
    const metadata=values.some(v=>v&&typeof v==='object'&&Number.isInteger(v.metadata)&&v.metadata>=0)||Number.isInteger(r.result.metadata)&&r.result.metadata>0;
    return { id: `overmind:craft/${out}/${n}`, type: r.inShape ? 'minecraft:crafting_shaped' : 'minecraft:crafting_shapeless', output: { item: itemNames.get(r.result.id), count: r.result.count },
      ingredients: [...counts].map(([item, count]) => ({ choices: [item], count })), station: r.inShape ? r.inShape.length > 2 || r.inShape.some(row => row.length > 2) ? 'minecraft:crafting_table' : null : (r.ingredients?.length > 4 ? 'minecraft:crafting_table' : null),
      executable: !hasReturns&&!metadata, reason: metadata?'A metadata-aware recipe executor is required.':hasReturns?'The recipe returns containers; inventory balances must account for them.':'',...(metadata?{raw:clone(r)}:{}) };
  }));
  return createCatalog({ version: data.version.minecraftVersion, items, blocks, recipes });
}
