import { jsonCopy } from '../src/config.js';
// A deterministic, offline example. It never connects to Minecraft.
export function createSimulator(initial = {}) {
  const recipes = {
    'minecraft:oak_planks': { input: { 'minecraft:oak_log': 1 }, output: 4 },
    'minecraft:stick': { input: { 'minecraft:oak_planks': 2 }, output: 4 },
    'minecraft:crafting_table': { input: { 'minecraft:oak_planks': 4 }, output: 1 },
  };
  const seed = jsonCopy(initial);
  const world = { dimension: 'minecraft:overworld', ...seed, self: { health: 20, food: 12, position: { x: 0, y: 64, z: 0 }, ...seed.self },
    inventory: { 'minecraft:oak_log': 0, 'minecraft:bread': 3, 'minecraft:oak_planks': 0, 'minecraft:stick': 0, 'minecraft:crafting_table': 0, ...seed.inventory } };
  return {
    describe: () => ({ protocolVersion: 1, kind: 'simulator', loader: 'vanilla', minecraftVersion: 'simulation', skills: ['eat', 'gather', 'craft'] }),
    observe: async ({ signal }) => { signal.throwIfAborted(); return jsonCopy(world); },
    execute: async ({ skill, args }, { signal }) => {
      signal.throwIfAborted();
      if (skill === 'eat') {
        if (world.inventory['minecraft:bread'] < 1) throw new Error('Нет хлеба.');
        world.inventory['minecraft:bread']--; world.self.food = Math.min(20, world.self.food + 5);
      } else if (skill === 'gather') {
        if (typeof args.block !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(args.block) || !Number.isInteger(args.count) || args.count < 1 || args.count > 16) throw new Error('Укажи block (namespace:id) и count от 1 до 16.');
        world.inventory[args.block] = (world.inventory[args.block] || 0) + args.count;
      } else if (skill === 'craft') {
        const recipe = Object.hasOwn(recipes, args.item) ? recipes[args.item] : null, times = args.times ?? 1;
        if (!recipe || !Number.isInteger(times) || times < 1 || times > 16) throw new Error('Нет рецепта симулятора или неверное times (1–16).');
        for (const [item, count] of Object.entries(recipe.input)) if ((world.inventory[item] || 0) < count * times) throw new Error(`Не хватает ${item}.`);
        for (const [item, count] of Object.entries(recipe.input)) world.inventory[item] -= count * times;
        world.inventory[args.item] += recipe.output * times;
      } else throw new Error('Нет такого навыка в симуляторе.');
      return { ok: true };
    },
  };
}
