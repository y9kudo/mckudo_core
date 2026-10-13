import test from 'node:test';
import assert from 'node:assert/strict';
import nbt from 'prismarine-nbt';
import {gzipSync} from 'node:zlib';
import {parseSchematic,schematicBlueprint} from '../src/schematics.js';

const vanilla=()=>nbt.writeUncompressed(nbt.comp({
  size:nbt.list(nbt.int([2,1,2])),
  palette:nbt.list(nbt.comp([{Name:nbt.string('minecraft:stone')},{Name:nbt.string('minecraft:air')} ])),
  blocks:nbt.list(nbt.comp([
    {pos:nbt.list(nbt.int([0,0,0])),state:nbt.int(0)},
    {pos:nbt.list(nbt.int([1,0,0])),state:nbt.int(1)},
    {pos:nbt.list(nbt.int([0,0,1])),state:nbt.int(0)}
  ]))
}));

test('vanilla Structure NBT imports non-air cells and supports placement at an origin',()=>{
  const s=parseSchematic(vanilla(),{filename:'test.nbt'});
  assert.equal(s.format,'nbt');assert.equal(s.blockCount,2);
  assert.deepEqual(s.size,{x:2,y:1,z:2});
  const b=schematicBlueprint(s,{x:10,y:64,z:-5});
  assert.deepEqual(b.cells.map(c=>[c.x,c.y,c.z]),[[10,64,-5],[10,64,-4]]);
});

test('Litematica packed indices and multi-region coordinates import correctly',()=>{
  const palette=nbt.list(nbt.comp([{Name:nbt.string('minecraft:air')},{Name:nbt.string('minecraft:oak_planks')} ]));
  const region=(x,z)=>nbt.comp({Position:nbt.comp({x:nbt.int(x),y:nbt.int(0),z:nbt.int(z)}),Size:nbt.comp({x:nbt.int(2),y:nbt.int(1),z:nbt.int(1)}),BlockStatePalette:palette,BlockStates:nbt.longArray([[0,1]])});
  const source=nbt.writeUncompressed(nbt.comp({Regions:nbt.comp({A:region(5,0),B:region(7,1)})}));
  const s=parseSchematic(source,{filename:'test.litematica'});
  assert.equal(s.format,'litematic');assert.equal(s.blockCount,2);
  assert.deepEqual(s.cells.map(c=>[c.x,c.y,c.z]),[[0,0,0],[2,0,1]]);
});

test('schematic importer rejects stateful placement and excessive volume',()=>{
  const stateful=nbt.writeUncompressed(nbt.comp({size:nbt.list(nbt.int([1,1,1])),palette:nbt.list(nbt.comp([{Name:nbt.string('minecraft:oak_stairs'),Properties:nbt.comp({facing:nbt.string('north')})}])),blocks:nbt.list(nbt.comp([{pos:nbt.list(nbt.int([0,0,0])),state:nbt.int(0)}]))}));
  const s=parseSchematic(stateful,{filename:'stairs.nbt'});assert.equal(s.unsupportedStates,1);
  assert.throws(()=>schematicBlueprint(s,{x:0,y:64,z:0}),/свойствами/);
  assert.throws(()=>parseSchematic(vanilla(),{filename:'bad.zip'}),/расширение/);
});

const sponge=(version,states=[0,1,0,1],palette={'minecraft:stone':0,'minecraft:oak_planks':1},offset=[2,0,-1])=>{
  const data=nbt.byteArray(states);
  const fields={Version:nbt.int(version),DataVersion:nbt.int(3953),Width:nbt.short(2),Height:nbt.short(1),Length:nbt.short(2),Offset:nbt.intArray(offset)};
  if(version===2){fields.Palette=nbt.comp(Object.fromEntries(Object.entries(palette).map(([name,index])=>[name,nbt.int(index)])));fields.BlockData=data;}
  else fields.Blocks=nbt.comp({Palette:nbt.comp(Object.fromEntries(Object.entries(palette).map(([name,index])=>[name,nbt.int(index)]))),Data:data});
  return gzipSync(nbt.writeUncompressed(nbt.comp({Schematic:nbt.comp(fields)})));
};

test('Sponge WorldEdit .schem v2 and v3 decode compressed palettes, order and offset',()=>{
  for(const version of [2,3]){
    const s=parseSchematic(sponge(version),{filename:'house.schem'});
    assert.equal(s.format,'schem');assert.equal(s.blockCount,4);assert.equal(s.dataVersion,3953);
    assert.deepEqual(s.size,{x:2,y:1,z:2});
    assert.deepEqual(s.cells.map(c=>[c.x,c.y,c.z,c.block]),[
      [0,0,0,'minecraft:stone'],[1,0,0,'minecraft:oak_planks'],
      [0,0,1,'minecraft:stone'],[1,0,1,'minecraft:oak_planks']]);
    assert.deepEqual(schematicBlueprint(s,{x:10,y:64,z:20}).cells[0],{x:12,y:64,z:19,block:'minecraft:stone'});
  }
});

test('Sponge .schem keeps state properties visible but refuses to place them incorrectly',()=>{
  const s=parseSchematic(sponge(3,[0,0,0,0],{'minecraft:oak_stairs[facing=east,half=bottom]':0}),{filename:'stairs.schem'});
  assert.equal(s.unsupportedStates,4);
  assert.deepEqual(s.cells[0].properties,{facing:'east',half:'bottom'});
  assert.throws(()=>schematicBlueprint(s,{x:0,y:64,z:0}),/свойствами/);
});

test('Sponge .schem rejects truncated and unknown palette indices',()=>{
  assert.throws(()=>parseSchematic(sponge(3,[0,1,0],{'minecraft:stone':0}),{filename:'bad.schem'}),/обрезанные/);
  assert.throws(()=>parseSchematic(sponge(2,[0,1,0,1],{'minecraft:stone':0}),{filename:'bad.schem'}),/отсутствует в палитре/);
  assert.throws(()=>parseSchematic(sponge(4),{filename:'bad.schem'}),/версий 2 и 3/);
});

test('legacy MCEdit .schematic imports simple blocks but rejects unsafe numeric metadata',()=>{
  const source=(ids,meta=[0,0])=>gzipSync(nbt.writeUncompressed(nbt.comp({Schematic:nbt.comp({
    Materials:nbt.string('Alpha'),Width:nbt.short(2),Height:nbt.short(1),Length:nbt.short(1),
    Blocks:nbt.byteArray(ids),Data:nbt.byteArray(meta)
  })})));
  const s=parseSchematic(source([1,4]),{filename:'old.schematic'});
  assert.equal(s.format,'schematic');assert.deepEqual(s.cells.map(c=>c.block),['minecraft:stone','minecraft:cobblestone']);
  assert.throws(()=>parseSchematic(source([5,4],[1,0]),{filename:'old.schematic'}),/преобразования/);
  assert.throws(()=>parseSchematic(source([53,4]),{filename:'old.schematic'}),/преобразования/);
});
