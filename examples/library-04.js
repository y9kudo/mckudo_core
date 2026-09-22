import { createCore, createShelterBlueprint, planConstruction, billOfMaterials, blockKey, planResources, resourceWorkflow, createSurvivalProgression, createConstructionReactor } from '../mckudo_core.js';
import { createCatalogSimulator } from '../adapters/catalog-simulator.js';
import { sampleCatalog, sampleSources } from './sample-catalog.js';

const catalog = sampleCatalog(), sources = sampleSources();
const stations = { 'minecraft:crafting_table': { x: -2, y: 64, z: 0 }, 'minecraft:furnace': { x: -2, y: 64, z: 1 } };
const blueprint = createShelterBlueprint({ origin: { x: 0, y: 64, z: 0 } });
const blocks = Object.fromEntries([...blueprint.cells, ...blueprint.air, ...blueprint.dependent, ...Object.values(stations)].map(p => [blockKey(p), 'minecraft:air']));
const adapter = createCatalogSimulator({ catalog, sources, blocks });
const goals = { 'minecraft:wooden_pickaxe': 1, 'minecraft:stone_pickaxe': 1, 'minecraft:iron_pickaxe': 1, ...billOfMaterials(blueprint) };
const plan = planResources({ catalog, targets: goals, sources, stations });
if (plan.status !== 'planned') throw new Error(plan.reason);
const core = createCore({ config: { schemaVersion: 4, name: 'LibraryExample', worldId: 'offline-example', workflows: [resourceWorkflow('materials', plan)] }, adapter });
const progression = createSurvivalProgression();
for (let i = 0; i < 64; i++) {
  const s = await core.tick(); progression.update(s.observation);
  if (s.workflows[0].status === 'completed') break;
  if (s.status === 'fault') throw new Error(s.reason);
}
if (core.snapshot().workflows[0].status !== 'completed') throw new Error('Цепочка ресурсов не завершена.');
await core.stop();
// Another application-controlled phase, with the same executor and a different core policy.
const builder = createCore({ config: { schemaVersion: 4, name: 'BuilderExample', worldId: 'offline-example' }, adapter, reactors: [createConstructionReactor({ blueprint })] });
for (let i = 0; i <= blueprint.cells.length; i++) {
  const s = await builder.tick();
  const result = planConstruction(blueprint, { blocks: s.observation.world.blocks, inventory: s.observation.inventory });
  if (result.status === 'completed') { console.log(JSON.stringify({ resourceActions: plan.actions.length, buildingBlocks: blueprint.cells.length, construction: result.status, stages: progression.exportMemory() }, null, 2)); await builder.stop(); break; }
  if (i === blueprint.cells.length || s.status === 'fault') throw new Error('Строительство не завершено: ' + s.reason);
}
