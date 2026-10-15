import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {createNetherReactor,netherCapabilities,netherVisitScenario,fullExpeditionScenario,validateScenario,createScenario,catalogFromMinecraftData,createSurvivalReactor,createEquipmentReactor,defineMission,findGroundShelterSite,createCombatReactor,createNetherPortalBlueprint,observedNetherPortalFrame,blockKey,resourceSources} from '../overmindmc.js';
import {OMProtection,OMConnect} from '../omconnect/index.js';
import {decideFallRescue} from '../packages/omconnect/src/fall-safety.js';
import {bridgeMaterials} from '../packages/omconnect/src/movement.js';

const registry=minecraftData('1.21.1'),catalog=catalogFromMinecraftData(registry);
const air={name:'air',boundingBox:'empty',shapes:[]},solid=name=>({name,boundingBox:'block',shapes:[[0,0,0,1,1,1]],hardness:1,diggable:true});
const fixture=(targets={'blaze_rod':1},extra={})=>{
  const blocks=new Map(),client={registry,options:{username:'NetherUnit'},world:{minY:0,blockAt:p=>blocks.get(`${p.x},${p.y},${p.z}`)||(p.y<64?solid('netherrack'):air)}};
  const o={dimension:'minecraft:the_nether',self:{position:{x:0,y:64,z:0},health:20,food:20},inventory:{},equipment:{},entities:[],drops:[],world:{sampledBlocks:[]}};
  return {blocks,client,o,r:createNetherReactor({client,catalog,targets,...extra})};
};

test('Nether visit profile requires normal portal prerequisites, entry and a nonzero exploration goal',()=>{
  const scenario=validateScenario(netherVisitScenario()),portal=scenario.steps.findIndex(step=>step.type==='netherPortal'),travel=scenario.steps.findIndex(step=>step.type==='travel');
  assert.ok(scenario.steps.slice(0,portal).some(step=>step.targets?.['minecraft:diamond_pickaxe']===1&&step.targets?.['minecraft:obsidian']===14));assert.ok(travel>portal);
  assert.equal(scenario.steps.at(-1).type,'netherResources');assert.equal(scenario.steps.at(-1).exploreDistance,12);
  assert.throws(()=>validateScenario({schemaVersion:1,name:'Invalid',steps:[{id:'walk',type:'netherResources',targets:{'minecraft:quartz':1},exploreDistance:129}]}),/exploreDistance/);
});

test('Nether exploration does not complete at the portal, preserves its origin across restart and yields at low health',()=>{
  const {client,o,r}=fixture({quartz:1},{exploreDistance:12});o.inventory['minecraft:quartz']=1;
  assert.ok(r.react(o).action);assert.notEqual(r.snapshot().status,'completed');
  o.self.position.x=6;r.react(o);const memory=r.exportMemory();assert.equal(memory.maxExploredDistance,6);
  const restored=createNetherReactor({client,catalog,targets:{quartz:1},exploreDistance:12,memory});
  o.self.health=8;assert.equal(restored.react(o).action,null);assert.notEqual(restored.snapshot().status,'completed');
  o.self.health=20;o.self.position.x=12;assert.equal(restored.react(o).action,null);assert.equal(restored.snapshot().status,'completed');
  assert.throws(()=>createNetherReactor({client,catalog,targets:{quartz:1},exploreDistance:4,memory}),/exploration memory/);
});
test('Nether capability data is scoped to the connected registry and campaign validates',()=>{
  const domain=netherCapabilities(registry);assert.equal(domain.waterUsable,false);assert.equal(domain.bedsUsable,false);assert.ok(domain.groups.minerals.includes('minecraft:ancient_debris'));
  const s=validateScenario(fullExpeditionScenario());assert.equal(s.steps.at(-1).type,'dragon');assert.ok(s.steps.some(s=>s.type==='netherResources'&&s.targets['minecraft:nether_wart']===3));
  assert.equal(s.steps[0].targets['#logs'],8);assert.equal(s.steps[0].targets['minecraft:crafting_table'],1);assert.ok(s.steps.find(s=>s.type==='netherResources').targets['minecraft:ender_pearl']-s.steps.find(s=>s.type==='eyes').count>=4);
  assert.ok(s.steps.findIndex(s=>s.id==='nether-supplies')<s.steps.findIndex(s=>s.id==='enter-nether'));
});
test('Nether goal requires current inventory; killing or requesting an attack is not resource success',()=>{
  const {o,r}=fixture();o.entities=[{id:'2',name:'blaze',kind:'entity',position:{x:2,y:64,z:0}}];
  assert.equal(r.react(o).action.skill,'combat');r.recordResult({outcome:'success'},{skill:'combat',args:{entityId:'2'}});
  assert.notEqual(r.snapshot().status,'completed');o.entities=[];o.drops=[{id:'3',item:'minecraft:blaze_rod',count:1,position:{x:2,y:64,z:0}}];
  assert.equal(r.react(o).action.skill,'collect');o.inventory['minecraft:blaze_rod']=1;assert.equal(r.react(o).action,null);assert.equal(r.snapshot().status,'completed');
  o.dimension='minecraft:overworld';assert.equal(r.react(o).action,null);assert.equal(r.snapshot().status,'blocked');
});
test('bartering is bounded and cannot turn a spent ingot into a promised ender pearl',()=>{
  const {o,r}=fixture({ender_pearl:2},{maxBarters:1});o.equipment.feet={item:'minecraft:golden_boots',count:1};o.inventory['minecraft:gold_ingot']=5;
  o.entities=[{id:'4',name:'piglin',kind:'entity',position:{x:2,y:64,z:0},isBaby:false,hostile:false}];
  const action=r.react(o).action;assert.equal(action.skill,'barter');r.recordResult({outcome:'success'},action);
  assert.notEqual(r.react(o).action?.skill,'barter');assert.notEqual(r.snapshot().status,'completed');assert.equal(r.snapshot().barters,1);
  o.inventory['minecraft:ender_pearl']=2;r.react(o);assert.equal(r.snapshot().status,'completed');
});
test('Nether policy rejects baby/hostile piglins and equips gold before bartering',()=>{
  const {o,r}=fixture({ender_pearl:1});o.inventory={'minecraft:golden_boots':1,'minecraft:gold_ingot':1};
  assert.equal(r.react(o).action.skill,'equipArmor');o.equipment.feet={item:'minecraft:golden_boots',count:1};
  o.entities=[{id:'1',name:'piglin',kind:'entity',position:{x:2,y:64,z:0},isBaby:true}];assert.notEqual(r.react(o).action?.skill,'barter');
  o.entities[0].isBaby=false;o.entities[0].hostile=true;assert.notEqual(r.react(o).action?.skill,'barter');
});
test('a visible distant blaze is shot, while a blocked view never authorizes a shot',()=>{
  const {o,r}=fixture();o.inventory={'minecraft:bow':1,'minecraft:arrow':10};o.entities=[{id:'7',name:'blaze',position:{x:12,y:64,z:0},visible:true}];
  assert.equal(r.react(o).action.skill,'shoot');o.entities[0].visible=false;assert.notEqual(r.react(o).action?.skill,'shoot');
});
test('harvest mature wart beside fortress masonry, preserve immature crops and explicit protected regions',()=>{
  const {o,r,client,blocks}=fixture({nether_wart:2});const p={x:2,y:64,z:0};o.world.sampledBlocks=[{name:'minecraft:nether_wart',position:p,properties:{age:2}}];
  assert.notEqual(r.react(o).action?.skill,'dig');o.world.sampledBlocks[0].properties.age=3;assert.equal(r.react(o).action.skill,'dig');
  blocks.set('2,64,0',{name:'nether_wart',getProperties:()=>({age:3})});blocks.set('3,64,0',solid('nether_bricks'));
  const policy=new OMProtection();assert.equal(policy.check({operation:'dig',dimension:o.dimension,position:p,block:client.world.blockAt(p),getBlock:client.world.blockAt}).allowed,true);
  policy.add({id:'farm-owner',dimension:o.dimension,min:p,max:p});assert.equal(policy.check({operation:'dig',dimension:o.dimension,position:p,block:client.world.blockAt(p)}).allowed,false);
});
test('failed Nether routes change approach, do not keep repeating one blocked target',()=>{
  const {o,r}=fixture();o.entities=[{id:'2',name:'blaze',position:{x:10,y:64,z:0}}];
  const action=r.react(o).action;assert.equal(action.skill,'navigate');r.recordResult({outcome:'failure',detail:"No route"},action);
  assert.notDeepEqual(r.react(o).action,action);o.self.position.x=4;assert.deepEqual(r.react(o).action,action);
});
test('Nether memory restores landmarks and bartering budget, with bounds and target validation',()=>{
  const {o,r,client,blocks}=fixture();blocks.set('0,64,0',{name:'nether_portal'});o.world.sampledBlocks=[{name:'minecraft:nether_portal',position:{x:0,y:64,z:0}}];r.react(o);
  const memory=r.exportMemory();assert.equal(memory.landmarks.length,1);assert.doesNotThrow(()=>createNetherReactor({client,catalog,targets:{blaze_rod:1},memory}));
  assert.throws(()=>createNetherReactor({client,catalog,targets:{blaze_rod:2},memory}),/memory/);
});
test('equipment keeps exactly one gold piece in the Nether but upgrades it in the Overworld',()=>{
  const r=createEquipmentReactor(),o={dimension:'minecraft:the_nether',equipment:{feet:{item:'minecraft:golden_boots',count:1}},inventory:{'minecraft:iron_boots':1}};
  assert.equal(r.react(o).action,null);o.dimension='minecraft:overworld';assert.equal(r.react(o).action.args.item,'minecraft:iron_boots');
  o.dimension='minecraft:the_nether';o.equipment.feet.item='minecraft:iron_boots';o.inventory['minecraft:golden_boots']=1;assert.equal(r.react(o).action.args.item,'minecraft:golden_boots');
});
test('gold nuggets are crafted instead of searching for unavailable raw gold in the Nether',()=>{
  const {client,o}=fixture();o.world.sampledBlocks=[{name:'minecraft:crafting_table',position:{x:2,y:64,z:0}}];o.inventory['minecraft:gold_nugget']=9;const r=createSurvivalReactor({client,catalog,targets:{gold_ingot:1},exploration:false});
  const result=r.react(o);assert.equal(result.action.skill,'craft');assert.equal(result.action.args.item,'minecraft:gold_ingot');
});
test('a resumed scenario keeps its stage and Nether portal; restart rechecks equipment from the start',()=>{
  const definition={schemaVersion:1,name:'Roundtrip',steps:[{id:'gear',type:'resources',targets:{'minecraft:iron_sword':1}},{id:'rods',type:'blazeRods',count:1},{id:'back',type:'travel',dimension:'minecraft:overworld'}]};
  const p={x:2,y:64,z:0},first=createScenario({scenario:definition,catalog,getBlock:()=>({name:'nether_portal'})}),o={dimension:'minecraft:the_nether',self:{position:{x:0,y:64,z:0}},inventory:{'minecraft:iron_sword':1},world:{sampledBlocks:[{name:'minecraft:nether_portal',position:p}]},entities:[]};
  first.reactor.react(o);o.inventory['minecraft:blaze_rod']=1;first.reactor.react(o);
  const restored=createScenario({scenario:definition,catalog,getBlock:()=>({name:'nether_portal'}),memory:first.exportMemory()});
  o.world.sampledBlocks=[];assert.equal(restored.reactor.react(o).action.skill,'enterPortal');assert.equal(restored.snapshot().current,'back');
  restored.restart();assert.equal(restored.snapshot().current,'gear');assert.deepEqual(restored.snapshot().completed,[]);
  assert.throws(()=>createScenario({scenario:{...definition,name:'Other'},catalog,memory:first.exportMemory()}),/reference point/i);
});
test('beginner mission compiles Nether item names into validated domain goals',()=>{
  const scenario=defineMission([{nether:{blaze_rod:10,ender_pearl:20}}]);assert.deepEqual(scenario.steps[0],{id:'step_1',type:'netherResources',targets:{'minecraft:blaze_rod':10,'minecraft:ender_pearl':20}});
  assert.throws(()=>defineMission([{nether:{blaze_rod:-1}}]));assert.throws(()=>defineMission([{nether:{},get:'stone'}]));
});
test('water-based rescue and Enderman defense are never selected in the Nether',()=>{
  const state={position:{x:0,y:75,z:0},velocity:{x:0,y:-.5,z:0},onGround:false,health:20,dimension:'minecraft:the_nether'};
  assert.equal(decideFallRescue(state,p=>p.y<64?solid('netherrack'):air,{water_bucket:1},{highestY:78}),null);
  const r=createCombatReactor({attackPlayers:false}),o={dimension:'minecraft:the_nether',self:{position:{x:0,y:64,z:0},health:20},inventory:{'minecraft:water_bucket':1},entities:[{id:'2',name:'enderman',position:{x:2,y:64,z:0},provoked:true}],combat:{attackers:[{entityId:'2',hits:2,lastHitAt:Date.now()}]}};
  assert.notEqual(r.react(o).action?.skill,'waterGuard');
});
test('Nether bridges and pillars reserve inflammable woods, allow fireproof Nether planks and ordinary stone',()=>{
  const items=['oak_planks','warped_planks','cobblestone'].map(name=>({name,count:16,slot:9}));
  assert.deepEqual(bridgeMaterials(registry,items,{dimension:'minecraft:the_nether'}).map(b=>b.name).sort(),['cobblestone','warped_planks']);
  assert.equal(bridgeMaterials(registry,items,{dimension:'minecraft:overworld'}).length,3);
});
test('Nether bridge fallback requires a fully observed corridor and solid destination',()=>{
  const {o,r,client}=fixture({blaze_rod:1},{explorationPlanner:{poll:()=>({status:'blocked'}),invalidate(){}}});
  client.inventory={items:()=>[{name:'cobblestone',count:4,slot:9}]};
  client.world.blockAt=p=>p.y===63&&p.z===0&&[0,4].includes(p.x)?solid('netherrack'):air;
  const response=r.react(o);assert.equal(response.action.skill,'bridgeTo');assert.deepEqual(response.action.args,{x:4,y:64,z:0});
  const known=client.world.blockAt;client.world.blockAt=p=>p.x===2?null:known(p);assert.notEqual(r.react(o).action?.skill,'bridgeTo');
});
test('a walkable grass plant is not an empty construction site',()=>{
  const grass={name:'short_grass',boundingBox:'empty',shapes:[]};
  assert.equal(findGroundShelterSite({near:{x:0,y:64,z:0},radius:0,maxRise:0,getBlock:p=>p.y<64?solid('grass_block'):p.y===64?grass:air}),null);
});
test('Nether source library exposes real basic materials and glowstone dust instead of an assumed silk-touch block',()=>{
  const sources=resourceSources(catalog,{availableBlocks:['soul_sand','soul_soil','glowstone','ancient_debris','nether_gold_ore']});
  for(const item of ['soul_sand','soul_soil','glowstone_dust','ancient_debris','gold_nugget'])assert.ok(sources.some(s=>s.item==='minecraft:'+item),item);
  const {o,client,blocks}=fixture({soul_sand:1});blocks.set('2,64,0',solid('soul_sand'));o.world.sampledBlocks=[{name:'minecraft:soul_sand',position:{x:2,y:64,z:0}}];
  assert.equal(createSurvivalReactor({client,catalog,targets:{soul_sand:1},exploration:false}).react(o).action.args.block,'minecraft:soul_sand');
});
test('a remembered extinguished Nether portal is relit only when the complete real frame is observed',()=>{
  const blueprint=createNetherPortalBlueprint({origin:{x:3,y:64,z:0},axis:'z'}),blocks=new Map();
  for(const p of blueprint.cells)blocks.set(blockKey(p),solid('obsidian'));for(const p of blueprint.air)blocks.set(blockKey(p),{name:'nether_portal'});
  const getBlock=p=>blocks.get(blockKey(p))||null,interior=blueprint.air[0];
  assert.equal(observedNetherPortalFrame({interior,getBlock}).axis,'z');
  const scenario=createScenario({catalog,getBlock,scenario:{schemaVersion:1,name:'Relight return',steps:[{id:'rods',type:'blazeRods',count:1},{id:'return',type:'travel',dimension:'minecraft:overworld'}]}});
  const o={dimension:'minecraft:the_nether',self:{position:{x:0,y:64,z:0}},inventory:{'minecraft:flint_and_steel':1},world:{sampledBlocks:[{name:'minecraft:nether_portal',position:interior}]},entities:[]};
  scenario.reactor.react(o);for(const p of blueprint.air)blocks.set(blockKey(p),air);o.world.sampledBlocks=[];o.inventory['minecraft:blaze_rod']=1;
  const r=scenario.reactor.react(o);assert.equal(r.action.skill,'ignitePortal');assert.deepEqual(r.action.args,{origin:blueprint.origin,axis:'z'});assert.notEqual(scenario.snapshot().status,'completed');
  blocks.delete(blockKey(blueprint.cells[0]));assert.equal(observedNetherPortalFrame({interior,getBlock}),null);assert.notEqual(scenario.reactor.react(o).action?.skill,'ignitePortal');
});
test('a cancelled barter still spends its budget if the native client confirmed gold consumption',()=>{
  const {o,r,client}=fixture({ender_pearl:1},{maxBarters:1});client.metrics={barterGoldSpent:0};o.equipment.feet={item:'minecraft:golden_boots',count:1};o.inventory['minecraft:gold_ingot']=2;o.entities=[{id:'1',name:'piglin',position:{x:2,y:64,z:0},isBaby:false,hostile:false}];
  const action=r.react(o).action;assert.equal(action.skill,'barter');client.metrics.barterGoldSpent++;r.recordResult({outcome:'cancelled'},action);
  r.react(o);assert.equal(r.snapshot().barters,1);assert.notEqual(r.react(o).action?.skill,'barter');
});
test('survival replaces an unusable pickaxe instead of repeatedly trying to mine with a worn stack',()=>{
  const c=new OMConnect(),item=c.registry.itemsByName.stone_pickaxe,ore={...c.registry.blocksByName.iron_ore,name:'iron_ore',shapes:[[0,0,0,1,1,1]]};
  c.inventory.slots[36]={name:'stone_pickaxe',type:item.id,item:'minecraft:stone_pickaxe',slot:36,count:1,raw:{components:[{type:'damage',data:item.maxDurability-1}]}};
  c.world.blockAt=p=>p.x===4&&p.y===64?ore:p.y<64?solid('stone'):air;
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20},inventory:{'minecraft:stone_pickaxe':1,'minecraft:cobblestone':3,'minecraft:stick':2},world:{sampledBlocks:[{name:'minecraft:iron_ore',position:{x:4,y:64,z:0}},{name:'minecraft:crafting_table',position:{x:2,y:64,z:0}}]}};
  const r=createSurvivalReactor({client:c,catalog,targets:{raw_iron:1},exploration:false}).react(o);assert.equal(r.action.skill,'craft');assert.equal(r.action.args.item,'minecraft:stone_pickaxe');
});
