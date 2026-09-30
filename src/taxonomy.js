import { resourceId } from './catalog.js';
import { jsonCopy } from './config.js';

const parents = { logs: ['tree', 'wood'], leaves: ['tree', 'vegetation'], saplings: ['tree', 'vegetation'], planks: ['wood', 'building'],
  deepslate_ores: ['ores'], ores: ['mineral'], stone: ['mineral', 'building'], soils: ['terrain'], crops: ['vegetation', 'food_source'],
  stairs: ['building'], slabs: ['building'], fences: ['building'], doors: ['building'], glass: ['building'], wool: ['building'],
  workstations: ['interactive'], containers: ['interactive'], liquids: ['hazards'], falling: ['terrain'], rails: ['transport'], redstone: ['interactive'] };
const rules = [
  ['beds', /_bed$/],
  ['logs', /(?:_log|_wood|_hyphae)$|^(?:stripped_)?(?:crimson_stem|warped_stem|bamboo_block)$/], ['leaves', /_leaves$/], ['saplings', /(?:_sapling|propagule)$/], ['planks', /_planks$/],
  ['ores', /(?:_ore|ancient_debris)$/], ['deepslate_ores', /^deepslate_.*_ore$/], ['stairs', /_stairs$/], ['slabs', /_slab$/],
  ['fences', /_fence(?:_gate)?$/], ['doors', /(?:_door|_trapdoor)$/], ['glass', /glass(?:_pane)?$/], ['wool', /_wool$/],
  ['stone', /^(?:stone|cobblestone|cobbled_deepslate|deepslate|granite|diorite|andesite|tuff|blackstone|basalt|end_stone|netherrack)$/],
  ['soils', /^(?:dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|farmland|clay)$/],
  ['crops', /^(?:wheat|carrots|potatoes|beetroots|sweet_berry_bush|cocoa|nether_wart)$/],
  ['workstations', /^(?:crafting_table|furnace|smoker|blast_furnace|stonecutter|smithing_table|loom|grindstone|brewing_stand|anvil|enchanting_table)$/],
  ['containers', /(?:chest|barrel|shulker_box|hopper)$/], ['liquids', /^(?:water|lava)$/], ['falling', /^(?:sand|red_sand|gravel|.*concrete_powder)$/],
  ['hazards', /^(?:lava|fire|soul_fire|cactus|magma_block|powder_snow|sweet_berry_bush|wither_rose)$/],
  ['rails', /rail$/], ['redstone', /(?:redstone|piston|repeater|comparator|observer|lever|_button|_pressure_plate)/]
];

/** Overlapping semantic classes plus caller-owned tags. No class implies recipe equivalence. */
export function createBlockTaxonomy(catalog, { classes = {}, tags = {} } = {}) {
  const definitions = jsonCopy(classes), tagData = jsonCopy(tags), byBlock = new Map(), byClass = new Map();
  const ancestry = { ...parents, ...Object.fromEntries(Object.entries(definitions).map(([k, v]) => [k, v.parents || []])) };
  for (const [name, def] of Object.entries(definitions)) {
    if (!/^[a-z0-9_:./-]+$/.test(name) || !Array.isArray(def.members || []) || !Array.isArray(def.parents || [])) throw new Error('Класс: нужны имя, members и parents.');
  }
  const expand = (name, stack = []) => {
    if (stack.includes(name) || stack.length > 32) throw new Error(`Цикл классов: ${name}`);
    return [name, ...(ancestry[name] || []).flatMap(p => expand(p, [...stack, name]))];
  };
  Object.keys(ancestry).forEach(n => expand(n));
  const resolveTag = (name, stack = []) => {
    if (stack.includes(name) || stack.length > 32) throw new Error(`Цикл тегов блоков: ${name}`);
    const values = tagData[name]?.values || tagData[name];
    if (!Array.isArray(values)) throw new Error(`Неизвестный тег блоков: ${name}`);
    return values.flatMap(v => {
      const id = typeof v === 'string' ? v : v.id;
      if (id.startsWith('#')) {
        const ref = resourceId(id.slice(1));
        if (v.required === false && !tagData[ref]) return [];
        return resolveTag(ref, [...stack, name]);
      }
      return [resourceId(id)];
    });
  };
  const extra = new Map();
  const add = (block, name) => { const id = resourceId(block); if (!catalog.block(id)) throw new Error(`Класс ссылается на неизвестный блок ${id}.`); if (!extra.has(id)) extra.set(id, []); extra.get(id).push(name); };
  for (const [name, def] of Object.entries(definitions)) for (const b of def.members || []) add(b, name);
  for (const name of Object.keys(tagData)) for (const b of resolveTag(name)) if (catalog.block(b)) add(b, `tag:${name}`);
  for (const block of catalog.blocks()) {
    const labels = ['all', block.boundingBox === 'block' ? 'solid' : block.boundingBox === 'empty' ? 'non_solid' : 'shape_unknown',
      ...(block.diggable ? ['diggable'] : []), ...rules.filter(([, re]) => re.test(block.id.split(':')[1])).map(([n]) => n), ...(extra.get(block.id) || [])];
    const expanded = [...new Set(labels.flatMap(n => expand(n)))].sort();
    byBlock.set(block.id, expanded);
    for (const label of expanded) { if (!byClass.has(label)) byClass.set(label, new Set()); byClass.get(label).add(block.id); }
  }
  return Object.freeze({ classes: () => [...byClass.keys()].sort(), classesOf: id => [...(byBlock.get(resourceId(id)) || [])],
    has: (id, name) => byClass.get(name)?.has(resourceId(id)) || false, members: name => [...(byClass.get(name) || [])].sort(),
    select: ({ all = [], any = [], none = [] } = {}) => [...byBlock].filter(([, labels]) => all.every(c => labels.includes(c)) && (!any.length || any.some(c => labels.includes(c))) && none.every(c => !labels.includes(c))).map(([id]) => id) });
}

/** Conservative base drops for resource planning. Probabilistic leaves/crop drops need dedicated skills. */
export function resourceSources(catalog, { availableBlocks, taxonomy = createBlockTaxonomy(catalog) } = {}) {
  if (!Array.isArray(availableBlocks)) throw new Error('Передай наблюдаемые availableBlocks.');
  return [...new Set(availableBlocks.map(resourceId))].flatMap(id => {
    const b = catalog.block(id); if (!b || b.diggable === false) return [];
    if (id !== 'minecraft:obsidian' && !['logs', 'ores', 'stone', 'planks'].some(c => taxonomy.has(id, c))) return [];
    // These names have deterministic minimum drops without Silk Touch or Fortune.
    const n = id.split(':')[1], ore = n.replace(/^deepslate_/, '');
    const outputs = { iron_ore: 'raw_iron', gold_ore: 'raw_gold', copper_ore: 'raw_copper', coal_ore: 'coal', diamond_ore: 'diamond', emerald_ore: 'emerald', redstone_ore: 'redstone', lapis_ore: 'lapis_lazuli', nether_quartz_ore: 'quartz', nether_gold_ore: 'gold_nugget', stone: 'cobblestone', deepslate: 'cobbled_deepslate' };
    const item = id.startsWith('minecraft:') ? resourceId(outputs[ore] || n) : b.drops?.length === 1 ? b.drops[0] : null;
    return item && catalog.item(item) ? [{ item, block: id, tools: [...(b.harvestTools || [])] }] : [];
  });
}
