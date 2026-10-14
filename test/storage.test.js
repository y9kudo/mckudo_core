import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {STORAGE_CATEGORIES,storageCategory,findLabelledStorage} from '../overmindmc.js';
const registry=minecraftData('1.21.1');
test('warehouse categories cover every item and group equivalent wood species',()=>{
  for(const item of registry.itemsArray)assert.ok(Object.hasOwn(STORAGE_CATEGORIES,storageCategory(item,registry)));
  for(const item of ['oak_log','birch_log','acacia_log','spruce_planks','stone','sand'])assert.equal(storageCategory(item,registry),'building');
  for(const [item,expected] of Object.entries({ancient_debris:'resources',gold_ingot:'resources',diamond_shovel:'equipment',turtle_helmet:'equipment',cooked_beef:'food',feather:'nature',oak_sign:'other'}))assert.equal(storageCategory(item,registry),expected);
});
test('label discovery follows wall-sign orientation and rejects duplicate user labels',()=>{
  const sign={position:{x:3,y:72,z:1},front:['Random','','',''],back:[]};
  const client={findSigns:()=>[sign],world:{blockAt:()=>({name:'oak_wall_sign',getProperties:()=>({facing:'east'})})}};
  assert.deepEqual(findLabelledStorage(client,'Random'),{x:2,y:72,z:1});client.findSigns=()=>[sign,sign];assert.throws(()=>findLabelledStorage(client,'Random'),/found 2/);
});
