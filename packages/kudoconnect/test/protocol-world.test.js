import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { recipeProtocol } from '../src/protocol-compat.js';
import { KudoWorld } from '../src/world.js';

test('1.21.1 recipe ID 15 decodes as smelting without modifying shared registry', () => {
  const registry = minecraftData('1.21.1'), before = JSON.stringify(registry.protocol);
  const {parser,serializer} = recipeProtocol(registry);
  const packet = {name:'declare_recipes',params:{recipes:[{name:'minecraft:iron_ingot',type:'minecraft:smelting',data:{group:'',category:0,ingredient:[],result:{itemCount:0},experience:.7,cookTime:200}}]}};
  const buffer = serializer.createPacketBuffer(packet);
  // packet id, recipe count, string length, name, then the serializer ID.
  assert.equal(buffer[3 + Buffer.byteLength('minecraft:iron_ingot')],15);
  const decoded = parser.parsePacketBuffer(buffer).data.params.recipes[0];
  assert.equal(decoded.type,'minecraft:smelting'); assert.equal(decoded.data.cookTime,200);
  assert.equal(JSON.stringify(registry.protocol),before);
});

test('empty sections do not exhaust search budget before a distant birch or deep ore', async () => {
  const registry=minecraftData('1.21.1'), world=new KudoWorld(registry);
  for(let x=0;x<8;x++) world.columns.set(`${x},0`,new world.Chunk({minY:-64,worldHeight:384}));
  world.columns.get('7,0').setBlockStateId({x:1,y:64,z:1},registry.blocksByName.birch_log.defaultState);
  world.columns.get('0,0').setBlockStateId({x:1,y:-54,z:1},registry.blocksByName.deepslate_diamond_ore.defaultState);
  for(const [group,name] of [['#logs','minecraft:birch_log'],['#ores','minecraft:deepslate_diamond_ore']]) {
    const found=await world.findBlocks({classes:[group],position:{x:.5,y:64,z:.5},radius:128,maxVisited:8192});
    assert.equal(found.blocks[0]?.name,name); assert.equal(found.truncated,false); assert.equal(found.visited,4096);
  }
  const absent=await world.findBlocks({classes:['#workstations'],position:{x:.5,y:64,z:.5},radius:128,maxVisited:1});
  assert.equal(absent.truncated,false);assert.equal(absent.visited,0);
});
