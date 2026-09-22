import { jsonCopy, object } from './config.js';

export const resourceId = name => {
  if (typeof name !== 'string') throw new Error('Нужен строковый ID ресурса.');
  const value = name.includes(':') ? name : 'minecraft:' + name;
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(value)) throw new Error(`Неверный ID: ${name}`);
  return value;
};
const clone = value => jsonCopy(value, '$catalog', 32 * 1024 * 1024);
const resultOf = r => typeof r === 'string' ? { item: resourceId(r), count: 1 } : r?.id || r?.item ? { item: resourceId(r.id || r.item), count: r.count ?? 1 } : null;

/** Import every record; dynamic/special recipes remain indexed with executable=false. */
export function importVanillaRecipes(input, tags = {}) {
  const recipes = clone(input), tagData = clone(tags);
  const resolveTag = (name, stack = []) => {
    name = resourceId(name);
    if (stack.includes(name) || stack.length > 32) throw new Error(`Цикл тегов: ${name}`);
    const tag = tagData[name]; if (!tag) throw new Error(`Неизвестный тег: ${name}`);
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
    throw new Error('Неподдерживаемый ингредиент.');
  };
  return Object.entries(recipes).map(([name, raw]) => {
    const record = { id: resourceId(name), type: resourceId(raw.type), output: resultOf(raw.result), ingredients: [], station: null, executable: false, reason: '', raw };
    try {
      let slots = [];
      if (raw.type === 'minecraft:crafting_shaped') {
        if (!Array.isArray(raw.pattern)) throw new Error('Нет pattern.');
        slots = raw.pattern.flatMap(row => [...row].filter(c => c !== ' ').map(c => ingredient(raw.key[c])));
        record.station = raw.pattern.length > 2 || raw.pattern.some(r => r.length > 2) ? 'minecraft:crafting_table' : null;
      } else if (raw.type === 'minecraft:crafting_shapeless') {
        slots = raw.ingredients.map(ingredient); record.station = slots.length > 4 ? 'minecraft:crafting_table' : null;
      } else if (['minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking', 'minecraft:campfire_cooking', 'minecraft:stonecutting'].includes(raw.type)) {
        slots = [ingredient(raw.ingredient)];
        record.station = { 'minecraft:smelting': 'minecraft:furnace', 'minecraft:blasting': 'minecraft:blast_furnace', 'minecraft:smoking': 'minecraft:smoker', 'minecraft:campfire_cooking': 'minecraft:campfire', 'minecraft:stonecutting': 'minecraft:stonecutter' }[raw.type];
        record.cookingTime = raw.cookingtime ?? 0;
      } else throw new Error('Динамический или специальный рецепт: нужен отдельный исполнитель.');
      const grouped = new Map();
      for (const choices of slots) {
        if (!choices.length) throw new Error('Пустой тег ингредиента.');
        const key = [...choices].sort().join('|');
        if (!grouped.has(key)) grouped.set(key, { choices: [...choices].sort(), count: 0 });
        grouped.get(key).count++;
      }
      record.ingredients = [...grouped.values()];
      record.executable = Boolean(record.output) && ['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:smelting'].includes(raw.type);
      if (!record.executable) record.reason = 'Рецепт проиндексирован; исполнитель этого типа ещё не подключён.';
    } catch (error) { record.reason = String(error.message).slice(0, 300); }
    return record;
  });
}

export function createCatalog({ version, items, blocks, recipes = [] }) {
  if (typeof version !== 'string' || !version || version.length > 64) throw new Error('Каталогу нужна версия Minecraft.');
  if (![items, blocks, recipes].every(Array.isArray) || items.length > 50000 || blocks.length > 50000 || recipes.length > 100000) throw new Error('Каталог: неверные списки или превышен лимит записей.');
  const index = list => {
    const map = new Map();
    for (const raw of clone(list)) {
      const entry = { ...raw, id: resourceId(raw.id) };
      if (map.has(entry.id)) throw new Error(`Повтор ID: ${entry.id}`);
      map.set(entry.id, entry);
    }
    return map;
  };
  const itemMap = index(items), blockMap = index(blocks), recipeMap = index(recipes), byOutput = new Map();
  for (const r of recipeMap.values()) {
    if (!r.output) continue;
    if (!itemMap.has(r.output.item) || !Number.isInteger(r.output.count) || r.output.count < 1 || r.output.count > 64) throw new Error(`Неверный результат рецепта ${r.id}.`);
    if (!Array.isArray(r.ingredients)) throw new Error('Рецепту нужны ingredients.');
    for (const g of r.ingredients) if (!object(g) || !Number.isInteger(g.count) || g.count < 1 || !Array.isArray(g.choices) || !g.choices.length || g.choices.some(i => !itemMap.has(i))) throw new Error(`Неизвестный ингредиент ${r.id}.`);
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
export function catalogFromMinecraftData(data, { vanillaRecipes, tags } = {}) {
  const itemNames = new Map(data.itemsArray.map(i => [i.id, resourceId(i.name)]));
  const items = data.itemsArray.map(i => ({ id: resourceId(i.name), numericId: i.id, displayName: i.displayName, stackSize: i.stackSize ?? 64, maxDurability: i.maxDurability ?? null }));
  const blocks = data.blocksArray.map(b => ({ id: resourceId(b.name), numericId: b.id, displayName: b.displayName, hardness: b.hardness ?? null,
    diggable: b.diggable ?? false, boundingBox: b.boundingBox ?? null, drops: (b.drops || []).map(id => itemNames.get(typeof id === 'object' ? id.id : id)).filter(Boolean),
    harvestTools: Object.keys(b.harvestTools || {}).map(id => itemNames.get(Number(id))).filter(Boolean), states: b.states || [] }));
  let recipes;
  if (vanillaRecipes) recipes = importVanillaRecipes(vanillaRecipes, tags);
  else recipes = Object.entries(data.recipes || {}).flatMap(([out, variants]) => variants.map((r, n) => {
    const counts = new Map();
    for (const value of r.inShape?.flat() || r.ingredients || []) {
      const numericId = typeof value === 'object' && value !== null ? value.id : value;
      if (numericId == null || numericId < 0) continue;
      const item = itemNames.get(numericId); if (!item) throw new Error(`Нет item ID ${numericId}.`);
      counts.set(item, (counts.get(item) || 0) + (typeof value === 'object' ? value.count ?? 1 : 1));
    }
    const hasReturns = Boolean(r.outShape || r.outIngredients);
    return { id: `mckudo:craft/${out}/${n}`, type: r.inShape ? 'minecraft:crafting_shaped' : 'minecraft:crafting_shapeless', output: { item: itemNames.get(r.result.id), count: r.result.count },
      ingredients: [...counts].map(([item, count]) => ({ choices: [item], count })), station: r.inShape ? r.inShape.length > 2 || r.inShape.some(row => row.length > 2) ? 'minecraft:crafting_table' : null : (r.ingredients?.length > 4 ? 'minecraft:crafting_table' : null),
      executable: !hasReturns, reason: hasReturns ? 'Рецепт возвращает контейнеры; нужен отдельный учёт остатков.' : '' };
  }));
  return createCatalog({ version: data.version.minecraftVersion, items, blocks, recipes });
}
