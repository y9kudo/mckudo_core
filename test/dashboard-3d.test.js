import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisionVolume} from '../src/vision.js';
import {createDashboardTextures} from '../src/dashboard-textures.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
function zip(files){
  const locals=[],directory=[];let offset=0;
  for(const [filename,value]of Object.entries(files)){const name=Buffer.from(filename),raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value)),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(raw.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);locals.push(local,name,raw);directory.push(central,name);offset+=local.length+name.length+raw.length;}
  const data=Buffer.concat(locals),catalog=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(catalog.length,12);end.writeUInt32LE(data.length,16);return Buffer.concat([data,catalog,end]);
}
test('3D snapshots contain real loaded blocks, live positions, routes and an explicit geometry budget',async()=>{
  let reads=0;const block={name:'stone',stateId:1,shapes:[[0,0,0,1,1,1]],getProperties:()=>({})},air={name:'air',stateId:0};
  const client={state:{position:{x:0,y:64,z:0},dimension:'minecraft:overworld',yaw:0,pitch:0,health:20},world:{revision:1,columns:new Map([['0,0',{}]]),columnAt:p=>p.x<=1,blockAt:p=>{reads++;return p.y<64?block:air;}},entities:new Map(),protection:{regions:[]},navigationDebug:{dimension:'minecraft:overworld',goal:{x:2,y:64,z:0},steps:[{kind:'walk',position:{x:1,y:64,z:0}}]}};
  const first=await createVisionVolume(client,{radius:2,down:2,up:2,maxBlocks:3});assert.equal(first.status,'ready');assert.equal(first.blocks.length,3);assert.equal(first.truncated,true);assert.ok(first.unknownCells>0);assert.ok(first.blocks.every(b=>b[0]<=1&&b[1]<0));assert.equal(first.palette[0].name,'minecraft:stone');assert.equal(first.route.steps[0].kind,'walk');
  first.palette[0].name='corrupted';first.blocks[0][0]=999;
  const before=reads;client.state.position.x=.5;const cached=await createVisionVolume(client,{radius:2,down:2,up:2,maxBlocks:3});assert.equal(reads,before);assert.equal(cached.self.position.x,.5);assert.equal(cached.palette[0].name,'minecraft:stone');assert.notEqual(cached.blocks[0][0],999);
  client.world.revision++;await createVisionVolume(client,{radius:2,down:2,up:2,maxBlocks:3});assert.ok(reads>before);
  await assert.rejects(createVisionVolume(client,{radius:500}),/budget/);
});
test('texture packs resolve inherited face aliases and variants without writing assets to disk',()=>{
  const store=createDashboardTextures(),archive=zip({'assets/minecraft/textures/block/test.png':png,'assets/minecraft/models/block/base.json':{textures:{all:'minecraft:block/test'},elements:[{from:[0,0,0],to:[16,16,16],faces:{up:{texture:'#all'},north:{texture:'#all'}}}]},'assets/minecraft/models/block/test.json':{parent:'minecraft:block/base'},'assets/minecraft/blockstates/test.json':{variants:{'axis=y':{model:'minecraft:block/test'},'axis=x':{model:'minecraft:block/test',y:90}}}});
  const result=store.import(archive,'pack.zip');assert.equal(result.textures,1);assert.equal(result.localOnly,true);assert.equal(store.describe('minecraft:test',{axis:'x'}).models[0].y,90);assert.equal(store.describe('test',{axis:'y'}).models[0].elements[0].faces.up.texture,'block/test');assert.equal(store.texture('block/test').width,1);
  assert.throws(()=>store.import(Buffer.alloc(30),'broken.zip'),/ZIP/);assert.equal(store.snapshot().revision,1);assert.equal(store.describe('not_installed').models.length,0);
});
