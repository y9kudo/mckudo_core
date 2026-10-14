import test from 'node:test';
import assert from 'node:assert/strict';
import md from 'minecraft-data';
import {WorldRecipeBook} from '../src/recipes.js';
import {recipeProtocol} from '../src/protocol-compat.js';
import {chooseCraftingRecipe,craftingRecipes} from '../src/crafting.js';
import {versionSupport} from '../src/versions.js';
import {OMConnect} from '../src/client.js';
const registry=md('1.21.1');
const slot=(name,n=1)=>({itemId:registry.itemsByName[name].id,itemCount:n,components:[],removeComponents:[]});
const plank=[slot('oak_planks'),slot('birch_planks')];
const table={name:'minecraft:crafting_table',type:'minecraft:crafting_shaped',data:{group:'',category:0,gridWidth:2,gridHeight:2,ingredients:[[plank,plank],[plank,plank]],result:slot('crafting_table'),showNotification:true}};
test('server recipe book is lazy, authoritative and groups repeated alternatives',()=>{
  const book=new WorldRecipeBook(registry);assert.deepEqual(craftingRecipes(registry,'crafting_table',book),[]);
  const {parser,serializer}=recipeProtocol(registry),packet=parser.parsePacketBuffer(serializer.createPacketBuffer({name:'declare_recipes',params:{recipes:[table]}})).data.params;
  book.ingest(packet);assert.equal(book.snapshot().indexedOutputs,0);
  assert.equal(book.recipesFor('crafting_table')[0].ingredients[0].count,4);
  const r=chooseCraftingRecipe(registry,'crafting_table',{oak_planks:2,birch_planks:2},{recipeBook:book});assert.equal(r.cells.length,4);
  assert.deepEqual(craftingRecipes(registry,'stick',book),[]);
  book.ingest({recipes:[]});assert.equal(book.snapshot().indexedOutputs,0);assert.deepEqual(book.recipesFor('crafting_table'),[]);
});
test('non-square shaped recipes retain row-major coordinates through the wire reader',()=>{
  const r={...table,name:'minecraft:stick',data:{...table.data,gridWidth:1,gridHeight:2,ingredients:[[plank,plank]],result:slot('stick',4)}};
  const {parser,serializer}=recipeProtocol(registry),book=new WorldRecipeBook(registry);
  book.ingest(parser.parsePacketBuffer(serializer.createPacketBuffer({name:'declare_recipes',params:{recipes:[r]}})).data.params);
  const recipe=book.recipesFor('stick')[0];assert.deepEqual(recipe.cells.map(c=>[c.x,c.y]),[[0,0],[0,1]]);assert.equal(recipe.station,null);
});
test('version capabilities distinguish catalog, transport and native executor; client is lazy',async()=>{
  const c=new OMConnect({version:'1.21'});assert.equal(c.dataLoaded,false);c.snapshot();assert.equal(c.dataLoaded,false);
  assert.equal(versionSupport('1.21').native,true);assert.equal(versionSupport('1.7.10').native,false);assert.equal(versionSupport('26.3').native,false);assert.equal(versionSupport('definitely-unknown').known,false);
  assert.throws(()=>new OMConnect({version:'26.3'}),/versionSupport/);await c.close();
});
