import { normalizeObservation } from '../src/perception.js';
import { jsonCopy } from '../src/config.js';
import { blockKey } from '../src/construction.js';

/** Test executor. Inventory/world effects only; no claims of Minecraft physics. */
export function createCatalogSimulator({ catalog, inventory = {}, blocks = {}, sources = [], entities = [], self = {}, combat = {} }) {
  const state = normalizeObservation({ inventory: Object.fromEntries(catalog.items().map(i => [i.id, inventory[i.id] || 0])), world: { dimension: 'minecraft:overworld', blocks: jsonCopy(blocks) },
    self: { health: 20, food: 20, position: { x: 0, y: 64, z: 0 }, ...self }, entities: jsonCopy(entities), combat: jsonCopy(combat) });
  const consume = requirements => {
    for (const [item, count] of Object.entries(requirements)) if ((state.inventory[item] || 0) < count) throw new Error(`Not enough ${item}.`);
    for (const [item, count] of Object.entries(requirements)) state.inventory[item] -= count;
  };
  return {
    describe: () => ({ protocolVersion: 1, perceptionVersion: 1, kind: 'catalog-simulator', loader: 'vanilla', minecraftVersion: catalog.version, skills: ['gather', 'craft', 'place', 'smelt', 'attack', 'flee'] }),
    observe: async ({ signal }) => { signal.throwIfAborted(); return jsonCopy(state); },
    async execute({ skill, args }, { signal }) {
      signal.throwIfAborted();
      if (skill === 'gather') {
        const source = sources.find(s => s.block === args.block);
        if (!source) throw new Error("No declared source.");
        if (source.tools?.length && !source.tools.some(t => state.inventory[t] > 0)) throw new Error("No mining tool.");
        state.inventory[source.item] = (state.inventory[source.item] || 0) + args.count;
      } else if (skill === 'place') {
        const key = blockKey(args), current = state.world.blocks[key];
        if (current === args.block) return { ok: true };
        if (current !== 'minecraft:air') throw new Error("Cell occupied or not observed.");
        const above = blockKey({ ...args, y: args.y + 1 });
        if (args.block.endsWith('_door') && state.world.blocks[above] !== 'minecraft:air') throw new Error("There's no room for a door.");
        consume({ [args.block]: 1 }); state.world.blocks[key] = args.block;
        if (args.block.endsWith('_door')) state.world.blocks[above] = args.block;
      } else if (skill === 'craft' || skill === 'smelt') {
        const times = skill === 'craft' ? args.times : args.count;
        if (!Number.isInteger(times) || times < 1 || times > (skill === 'craft' ? 16 : 64)) throw new Error("Wrong batch size.");
        const recipe = catalog.recipesFor(args.item).find(r => r.executable && (skill === 'smelt' ? ['minecraft:smelting', 'minecraft:smoking', 'minecraft:blasting'].includes(r.type) && (!args.station || args.station === r.station) && r.ingredients[0].choices.includes(args.input) : r.type.includes('crafting_') && r.ingredients.every(g => g.choices.some(i => (args.ingredients || {})[i] >= g.count))));
        if (!recipe) throw new Error("The recipe or ingredients do not match.");
        if (recipe.station && !Object.values(state.world.blocks).includes(recipe.station)) throw new Error("Need installed station.");
        const needs = skill === 'craft' ? Object.fromEntries(Object.entries(args.ingredients).map(([k, n]) => [k, n * times])) : { [args.input]: args.count };
        if (skill === 'smelt') needs[args.fuel] = (needs[args.fuel] || 0) + args.fuelCount;
        consume(needs); state.inventory[args.item] = (state.inventory[args.item] || 0) + recipe.output.count * times;
      } else if (skill === 'attack') state.entities = state.entities.filter(e => e.id !== args.entityId);
      else if (skill === 'flee') state.self.position.x += 16;
      else throw new Error("Unknown skill.");
      return { ok: true };
    }
  };
}
