import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,createCatalog,endExpeditionScenario,validateScenario,createEndExpedition,createGroundShelterBlueprint,findGroundShelterSite,planConstruction,blockKey,billOfMaterials} from '../overmindmc.js';
import {createOMConnect} from '../omconnect/index.js';

test('End expedition is a reusable native objective and only finishes on observed End travel',()=>{
  const definition=validateScenario(endExpeditionScenario());assert.equal(definition.steps.at(-1).dimension,'minecraft:the_end');
  assert.equal(definition.steps[0].targets['minecraft:stone_sword'],1);
  assert.ok(definition.steps.findIndex(s=>s.id==='first-shelter')<definition.steps.findIndex(s=>s.id==='early-shield'));
  assert.ok(definition.steps.findIndex(s=>s.id==='early-shield')<definition.steps.findIndex(s=>s.id==='iron-equipment'));
  const scenario={schemaVersion:1,name:'Gate',steps:[{id:'entry',type:'travel',dimension:'minecraft:the_end'}]};
  const c=createScenario({scenario,catalog:createCatalog({version:'test',items:[],blocks:[]})});
  const o={dimension:'minecraft:overworld',inventory:{},world:{sampledBlocks:[{name:'minecraft:end_portal',position:{x:0,y:0,z:0}}]}};
  assert.equal(c.reactor.react(o).action.skill,'enterPortal');assert.equal(c.snapshot().status,'running');
  c.reactor.react({...o,dimension:'minecraft:the_end'});assert.equal(c.snapshot().status,'completed');
});
test('shelter stage chooses observed natural ground, gathers materials and places a roofed home',()=>{
  const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const placed=new Map(),blockAt=p=>placed.get(blockKey(p))|| (p.y<64?stone:air);
  const site=findGroundShelterSite({near:{x:0,y:64,z:0},getBlock:blockAt,radius:2});assert.ok(site);
  const blueprint=createGroundShelterBlueprint({origin:site});assert.equal(blueprint.dependent.length,1);
  const blocks=Object.fromEntries([...blueprint.cells,...blueprint.air,...blueprint.dependent].map(p=>[blockKey(p),'minecraft:air']));
  assert.equal(planConstruction(blueprint,{blocks,inventory:billOfMaterials(blueprint)}).status,'ready');
  const scenario={schemaVersion:1,name:'Home',steps:[{id:'home',type:'shelter'}]};
  const c=createScenario({scenario,catalog:createCatalog({version:'test',items:[],blocks:[]}),getBlock:blockAt,
    resourceFactory:()=>({react:()=>({action:{skill:'gather',args:{classes:['#logs']}}})})});
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0}},inventory:{},world:{sampledBlocks:[]}};
  assert.equal(c.reactor.react(o).action.skill,'gather');
  o.inventory={'minecraft:oak_planks':128,'minecraft:oak_door':1};assert.equal(c.reactor.react(o).action.skill,'place');
  for(const cell of [...blueprint.cells,...blueprint.dependent])placed.set(blockKey(cell),{name:cell.block.slice(10),boundingBox:'block',shapes:[[0,0,0,1,1,1]]});
  assert.equal(c.reactor.react(o).action,null);assert.equal(c.snapshot().status,'completed');
});
test('scenario uses equipped inventory and forwards failures to its resource policy',()=>{
  let received;
  const c=createScenario({scenario:{schemaVersion:1,name:'Equipment',steps:[{id:'armor',type:'resources',targets:{'minecraft:iron_chestplate':1}}]},catalog:createCatalog({version:'test',items:[],blocks:[]}),resourceFactory:()=>({react:()=>({action:{skill:'craft',args:{item:'iron_chestplate'}}}),recordResult:e=>received=e})});
  c.reactor.react({inventory:{}});c.recordResult({outcome:'failure'},{skill:'craft'});assert.equal(received.outcome,'failure');
  c.reactor.react({inventory:{},equipment:{chest:{item:'minecraft:iron_chestplate',count:1}}});assert.equal(c.snapshot().status,'completed');
});
test('native expedition constructs with portal skills and hunting policy without a server',async()=>{
  const client=createOMConnect();const expedition=createEndExpedition({client,worldId:'unit-expedition'});
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20,food:20,freeInventorySlots:36},inventory:{},drops:[{id:'1',item:'minecraft:dirt',count:1,position:{x:2,y:64,z:0}},{id:'2',item:'minecraft:oak_log',count:1,position:{x:10,y:64,z:0}}]};
  assert.equal(expedition.brain.loot.react(o).action,null,'distant or disposable drops should not interrupt a campaign');
  o.drops[1].position.x=3;assert.equal(expedition.brain.loot.react(o).action.args.item,'minecraft:oak_log');
  assert.equal(expedition.snapshot().scenario.current,'stone-tools');await expedition.brain.stop();await client.close();
});
test('expedition restores learned planning and navigation across a resumed segment',async()=>{
  const worldId='unit-expedition-memory',client=createOMConnect();
  const first=createEndExpedition({client,worldId});
  client.emit('navigationStep',{from:{x:0,y:64,z:0},to:{x:1,y:64,z:0},dimension:'minecraft:overworld',kind:'walk',outcome:'failure'});
  const before={self:{position:{x:0,y:64,z:0},health:20},inventory:{},dimension:'minecraft:overworld',entities:[]};
  first.brain.cognition.record({before,after:before,action:{skill:'navigate',args:{x:1,y:64,z:0}},outcome:'failure'});
  const cognitionMemory=first.brain.cognition.export(),neuralMemory=first.brain.neural.export();
  await first.brain.stop();await client.close();
  const resumedClient=createOMConnect();const resumed=createEndExpedition({client:resumedClient,worldId,cognitionMemory,neuralMemory});
  assert.equal(resumed.brain.cognition.snapshot().samples,1);
  assert.equal(resumed.brain.neural.snapshot().samples,1);
  await resumed.brain.stop();await resumedClient.close();
});
