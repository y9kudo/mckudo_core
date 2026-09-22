// Small authored fixture for offline examples. Real applications import their game's full registry.
import { createCatalog, importVanillaRecipes } from '../mckudo_core.js';
const id = n => 'minecraft:' + n;
const items = ['oak_log','oak_planks','stick','crafting_table','wooden_pickaxe','cobblestone','stone_pickaxe','furnace','raw_iron','iron_ingot','iron_pickaxe','oak_door'];
const shaped = (pattern, key, result, count = 1) => ({ type: 'minecraft:crafting_shaped', pattern, key: Object.fromEntries(Object.entries(key).map(([k,v]) => [k, { item: id(v) }])), result: { id: id(result), count } });
export function sampleCatalog() {
  const recipes = {
    'minecraft:oak_planks': { type:'minecraft:crafting_shapeless', ingredients:[{item:id('oak_log')}], result:{id:id('oak_planks'),count:4} },
    'minecraft:stick': shaped(['P','P'],{P:'oak_planks'},'stick',4),
    'minecraft:crafting_table': shaped(['PP','PP'],{P:'oak_planks'},'crafting_table'),
    'minecraft:wooden_pickaxe': shaped(['PPP',' S ',' S '],{P:'oak_planks',S:'stick'},'wooden_pickaxe'),
    'minecraft:stone_pickaxe': shaped(['PPP',' S ',' S '],{P:'cobblestone',S:'stick'},'stone_pickaxe'),
    'minecraft:furnace': shaped(['PPP','P P','PPP'],{P:'cobblestone'},'furnace'),
    'minecraft:iron_ingot': {type:'minecraft:smelting',ingredient:{item:id('raw_iron')},result:{id:id('iron_ingot')},cookingtime:200},
    'minecraft:iron_pickaxe': shaped(['PPP',' S ',' S '],{P:'iron_ingot',S:'stick'},'iron_pickaxe'),
    'minecraft:oak_door': shaped(['PP','PP','PP'],{P:'oak_planks'},'oak_door',3)
  };
  return createCatalog({version:'1.21.1-demo',items:items.map(n=>({id:id(n)})),blocks:['oak_log','oak_planks','crafting_table','furnace','oak_door'].map(n=>({id:id(n)})),recipes:importVanillaRecipes(recipes)});
}
export const sampleSources = () => [
  {item:id('oak_log'),block:id('oak_log')},
  {item:id('cobblestone'),block:id('stone'),tools:[id('wooden_pickaxe'),id('stone_pickaxe'),id('iron_pickaxe')]},
  {item:id('raw_iron'),block:id('iron_ore'),tools:[id('stone_pickaxe'),id('iron_pickaxe')]}
];
