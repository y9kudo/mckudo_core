import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore, createCatalog, importVanillaRecipes, planResources, resourceWorkflow, createShelterBlueprint, validateBlueprint, billOfMaterials, planConstruction, createConstructionReactor, createSurvivalProgression, createDefenseReactor, blockKey } from '../mckudo_core.js';
import { createCatalogSimulator } from '../adapters/catalog-simulator.js';
import { sampleCatalog, sampleSources } from '../examples/sample-catalog.js';
const catalog = sampleCatalog(), sources = sampleSources();
const stationSlots = { 'minecraft:crafting_table': { x: -2, y: 64, z: 0 }, 'minecraft:furnace': { x: -2, y: 64, z: 1 } };
const cfg = extras => ({ schemaVersion:4,name:'Library',worldId:'test',...extras });
const stationBlocks = () => Object.fromEntries(Object.values(stationSlots).map(p=>[blockKey(p),'minecraft:air']));
const run = async (targets, inventory = {}) => {
  const plan = planResources({catalog,targets,inventory,sources,stations:stationSlots});assert.equal(plan.status,'planned',plan.reason);
  const adapter=createCatalogSimulator({catalog,inventory,sources,blocks:stationBlocks()});
  const core=createCore({config:cfg({workflows:[resourceWorkflow('supply',plan)]}),adapter});
  for(let i=0;i<64;i++){await core.tick();if(core.snapshot().workflows[0].status==='completed')break;if(core.snapshot().status==='fault')assert.fail(core.snapshot().reason);}
  assert.equal(core.snapshot().workflows[0].status,'completed');const final=await adapter.observe({signal:new AbortController().signal});
  for(const [id,count] of Object.entries(targets))assert.ok(final.inventory[id]>=count,`${id}: ${final.inventory[id]} < ${count}`);
  await core.stop();return {plan,final};
};
test('catalog retains all records including indexed unsupported recipes and isolates copies',()=>{
  const recipes=importVanillaRecipes({'minecraft:a':{type:'minecraft:smithing_trim',template:{item:'minecraft:oak_log'}}});
  const c=createCatalog({version:'test',items:[{id:'minecraft:oak_log'}],blocks:[],recipes});
  assert.equal(c.summary().recipes,1);assert.equal(c.recipe('a').executable,false);
  const item=c.item('oak_log');item.id='changed';assert.equal(c.item('oak_log').id,'minecraft:oak_log');
  assert.throws(()=>createCatalog({version:'test',items:[{id:'x'},{id:'x'}],blocks:[]}),/Повтор/);
});
test('tag alternatives resolve recursively; cycles and unknown tags remain explicit unsupported records',()=>{
  const raw={'minecraft:boards':{type:'minecraft:crafting_shapeless',ingredients:[{tag:'minecraft:logs'}],result:{id:'minecraft:oak_planks',count:4}}};
  const recipes=importVanillaRecipes(raw,{'minecraft:logs':{values:['#minecraft:logs2']},'minecraft:logs2':{values:['minecraft:oak_log']}});
  assert.deepEqual(recipes[0].ingredients[0].choices,['minecraft:oak_log']);
  const cycle=importVanillaRecipes(raw,{'minecraft:logs':{values:['#minecraft:logs']}});assert.equal(cycle[0].executable,false);assert.match(cycle[0].reason,/Цикл/);
});
test('resource planner makes and places a station before crafting wooden tools',async()=>{
  const {plan}=await run({'minecraft:wooden_pickaxe':1});
  assert.ok(plan.actions.findIndex(s=>s.action.skill==='place')<plan.actions.findIndex(s=>s.action.args.item==='minecraft:wooden_pickaxe'));
});
test('resource planner accounts for mining tools, furnace, fuel and iron progression',async()=>{
  const {final}=await run({'minecraft:iron_pickaxe':1});assert.ok(final.inventory['minecraft:stone_pickaxe']>=1);assert.ok(Object.values(final.world.blocks).includes('minecraft:furnace'));
});
test('reserved targets and pending recipe ingredients cannot cause false workflow skips',async()=>{
  await run({'minecraft:oak_planks':8,'minecraft:wooden_pickaxe':1,'minecraft:oak_door':3});
});
test('missing source, unknown item and search limits produce blocked plans without partial actions',()=>{
  for(const args of [{sources:[]},{targets:{'minecraft:missing':1}},{maxNodes:1},{stations:{}}]){
    const plan=planResources({catalog,targets:{'minecraft:iron_pickaxe':1},sources,stations:stationSlots,...args});assert.equal(plan.status,'blocked');assert.deepEqual(plan.actions,[]);
  }
});
test('blueprints include floor, roof, walls and a two-block door, reject conflicting coordinates',()=>{
  const b=createShelterBlueprint();assert.equal(b.dependent.length,1);assert.equal(billOfMaterials(b)['minecraft:oak_door'],1);
  assert.throws(()=>validateBlueprint({...b,cells:[...b.cells,b.cells[0]]}),/повторяющиеся/);
  assert.ok(b.cells.some(c=>c.y===b.origin.y));assert.ok(b.cells.some(c=>c.y===b.origin.y+b.size.height+1));
});
test('construction refuses unknown or occupied sites and reports material shortages',()=>{
  const b=createShelterBlueprint();assert.equal(planConstruction(b,{blocks:{}}).status,'blocked');
  const blocks=Object.fromEntries([...b.cells,...b.air,...b.dependent].map(p=>[blockKey(p),'minecraft:air']));
  assert.equal(planConstruction(b,{blocks}).status,'needs-materials');blocks[blockKey(b.cells[0])]='minecraft:chest';
  assert.equal(planConstruction(b,{blocks,inventory:billOfMaterials(b)}).status,'blocked');
});
test('construction reactor completes a shelter in a test executor and resumes existing blocks',async()=>{
  const blueprint=createShelterBlueprint({width:3,depth:3}), blocks=Object.fromEntries([...blueprint.cells,...blueprint.air,...blueprint.dependent].map(p=>[blockKey(p),'minecraft:air']));
  blocks[blockKey(blueprint.cells[0])]=blueprint.cells[0].block;
  const adapter=createCatalogSimulator({catalog,blocks,inventory:billOfMaterials(blueprint)});
  const core=createCore({config:cfg(),adapter,reactors:[createConstructionReactor({blueprint})]});
  for(let i=0;i<=blueprint.cells.length;i++)await core.tick();
  const o=await adapter.observe({signal:new AbortController().signal});assert.equal(planConstruction(blueprint,{blocks:o.world.blocks}).status,'completed');
  assert.equal(core.snapshot().history.filter(h=>h.outcome==='failure').length,0);await core.stop();
});
test('survival milestones are ordered and persist after resources are spent',()=>{
  const p=createSurvivalProgression();assert.equal(p.update({inventory:{'minecraft:iron_pickaxe':1}}).current.id,'wood');
  p.update({inventory:{'minecraft:crafting_table':1}});assert.equal(p.update({inventory:{}}).current.id,'wooden-tools');
  const restored=createSurvivalProgression(p.exportMemory());assert.equal(restored.update({inventory:{}}).current.id,'wooden-tools');
});
const world = overrides => ({self:{health:20,position:{x:0,y:64,z:0}},inventory:{},entities:[{id:'1',name:'zombie',kind:'entity',hostile:true,position:{x:2,y:64,z:0}}],...overrides});
test('defense attacks known mobs, retreats from creepers or low health and respects range',()=>{
  const defense=createDefenseReactor();assert.equal(defense.react(world()).action.skill,'attack');
  assert.equal(defense.react(world({self:{health:4,position:{x:0,y:64,z:0}}})).action.skill,'flee');
  assert.equal(defense.react(world({entities:[{...world().entities[0],name:'creeper'}]})).action.skill,'flee');
  assert.equal(defense.react(world({entities:[{...world().entities[0],position:{x:100,y:64,z:0}}]})).action,null);
});
test('PvP needs enabled policy and attributed repeated hits, expires and trusts configured players',()=>{
  const o=world({entities:[{id:'2',name:'player',kind:'player',username:'Friend',position:{x:2,y:64,z:0}}],combat:{attackers:[{entityId:'2',hits:2,lastHitAt:1000}]}});
  assert.equal(createDefenseReactor({clock:()=>2000}).react(o).action,null);
  assert.equal(createDefenseReactor({attackPlayers:true,clock:()=>2000}).react(o).action.skill,'attack');
  assert.equal(createDefenseReactor({attackPlayers:true,trustedPlayers:['Friend'],clock:()=>2000}).react(o).action,null);
  assert.equal(createDefenseReactor({attackPlayers:true,clock:()=>20000}).react(o).action,null);
  o.combat.attackers[0].hits=1;assert.equal(createDefenseReactor({attackPlayers:true,clock:()=>2000}).react(o).action,null);
});
test('Reactor priority, invalid results, unsupported skills and execution are controlled by kernel',async()=>{
  let called=0;const adapter={describe:()=>({protocolVersion:1,skills:['attack']}),observe:async()=>world(),execute:async()=>{called++;return{ok:true};}};
  const core=createCore({config:cfg(),adapter,reactors:[createDefenseReactor()]});await core.tick();assert.equal(called,1);assert.equal(core.snapshot().decision.kind,'reactor');
  const invalid=createCore({config:cfg(),adapter,reactors:[{id:'invalid',apiVersion:1,react:()=>({action:{skill:'attack'},priority:9999,reason:'bad'})}]});
  await invalid.tick();assert.equal(called,1);assert.equal(invalid.snapshot().trace.reactors[0].error,true);
  assert.throws(()=>createCore({config:cfg(),adapter}),/Добавь/);
});
