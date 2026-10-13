import test from 'node:test';
import assert from 'node:assert/strict';
import {findSchematicSite,buildSchematicPhysical} from '../src/schematics.js';

function mock(){
  const placed=new Map(),calls=[];let held=null;
  const key=p=>`${p.x},${p.y},${p.z}`;
  const client={state:{gameMode:'creative',position:{x:0,y:64,z:0}},world:{minY:-64,blockAt(p){return placed.get(key(p))|| (p.y===63?{name:'stone',boundingBox:'block',getProperties:()=>({})}:{name:'air',boundingBox:'empty',getProperties:()=>({})});}},registry:{itemsByName:{stone:{stackSize:64},oak_stairs:{stackSize:64}}},inventory:{selected:0,held:()=>held},async execute(action){calls.push(action);if(action.skill==='creativeTake'){held={name:action.args.item.replace('minecraft:',''),raw:{components:[{type:'block_state',data:{properties:Object.entries(action.args.properties).map(([property,value])=>({property,value}))}}]}};return {ok:true};}if(action.skill==='place'){placed.set(key(action.args),{name:action.args.block.replace('minecraft:',''),boundingBox:'block',getProperties:()=>Object.fromEntries(Object.entries(action.args.properties||{}))});return {ok:true};}throw new Error('unexpected skill');}};
  return {client,placed,calls,key};
}

test('Creative site search checks every cell and refuses occupied ground',()=>{
  const {client,placed,key}=mock(),schematic={size:{x:2,y:2,z:2},offset:{x:-8,y:0,z:3}};
  placed.set(key({x:1,y:64,z:0}),{name:'oak_planks',boundingBox:'block'});
  const site=findSchematicSite(client,schematic,{minDistance:1,maxDistance:1});
  assert.ok(site);assert.notDeepEqual(site.site,{x:1,y:64,z:0});
  assert.deepEqual(site.origin,{x:site.site.x+8,y:site.site.y,z:site.site.z-3});
});

test('Creative schematic places blocks one by one with their states and resumes',async()=>{
  const {client,calls}=mock(),schematic={offset:{x:0,y:0,z:0},cells:[{x:0,y:0,z:0,block:'minecraft:stone',properties:{}},{x:1,y:0,z:0,block:'minecraft:oak_stairs',properties:{facing:'east'}}]};
  const origin={x:10,y:64,z:10};
  const first=await buildSchematicPhysical(client,schematic,origin,{maxActions:1});
  assert.equal(first.status,'partial');assert.equal(first.remaining,1);
  const second=await buildSchematicPhysical(client,schematic,origin,{maxActions:10});
  assert.equal(second.status,'completed');assert.equal(second.remaining,0);
  assert.deepEqual(calls.map(c=>c.skill),['creativeTake','place','creativeTake','place']);
  assert.deepEqual(calls.at(-1).args.properties,{facing:'east'});
});

test('two builders can split a schematic without targeting the same block',async()=>{
  const {client,calls}=mock(),schematic={offset:{x:0,y:0,z:0},cells:[0,1,2,3].map(x=>({x,y:0,z:0,block:'minecraft:stone',properties:{}}))};
  const origin={x:10,y:64,z:10};
  const west=await buildSchematicPhysical(client,schematic,origin,{cellFilter:cell=>cell.x<2,strategy:'layer'});
  const east=await buildSchematicPhysical(client,schematic,origin,{cellFilter:cell=>cell.x>=2,strategy:'nearest'});
  assert.equal(west.status,'completed');assert.equal(east.status,'completed');
  assert.equal(west.blockCount,2);assert.equal(east.blockCount,2);
  assert.deepEqual(calls.filter(c=>c.skill==='place').map(c=>c.args.x).sort((a,b)=>a-b),[10,11,12,13]);
});

test('rejected decorative cells stop after two attempts across construction batches',async()=>{
  const {client}=mock(),original=client.execute;let attempts=0;
  client.execute=async action=>{if(action.skill==='place'){attempts++;throw new Error('Server rejected placement');}return original(action);};
  const schematic={cells:[{x:0,y:0,z:0,block:'minecraft:stone',properties:{}}]},failureCounts=new Map();
  for(let i=0;i<5;i++)await buildSchematicPhysical(client,schematic,{x:10,y:64,z:10},{failureCounts});
  assert.equal(attempts,2);
});
