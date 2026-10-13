import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {createJava263Profile,WorldRecipeBook,KudoConnect} from '../kudoconnect/index.js';

const profile=()=>createJava263Profile({loadRegistry:()=>({}),createProtocolClient:()=>({}),chunkFactory:()=>({})});
test('experimental 26.3 wire adapter carries teleport pose, movement flags and structured block hits',()=>{
  const p=profile(),c={state:{position:{x:1,y:64,z:2},yaw:45,pitch:10,horizontalCollision:true}};
  assert.deepEqual(p.encodePacket('teleport_confirm',{teleportId:7},c).packet,{teleportId:7,x:1,y:64,z:2,yaw:45,pitch:10});
  assert.deepEqual(p.encodePacket('position_look',{onGround:true},c).packet.flags,{onGround:true,hasHorizontalCollision:true});
  const hit=p.encodePacket('block_place',{hand:0,location:{x:1,y:63,z:2},direction:1,cursorX:.5,cursorY:1,cursorZ:.5,sequence:3},c).packet;
  assert.equal(hit.hitResult.direction,1);assert.equal(hit.hitResult.worldBorderHit,false);assert.equal(hit.sequence,3);
  assert.equal(p.encodePacket('entity_action',{actionId:'start_sneaking'},c).skip,true);
});
test('experimental 26.3 reader translates stepped delta units and modern clock fields',()=>{
  const p=profile(),move={delta:{dX:.25,dY:-.5,dZ:1}};
  p.normalizeIncoming('rel_entity_move',move);assert.deepEqual([move.dX,move.dY,move.dZ],[1024,-2048,4096]);
  const clock={gameTime:123n,clockUpdates:[{totalTicks:456n}]};p.normalizeIncoming('update_time',clock);assert.equal(clock.time,456n);assert.equal(clock.age,123n);
});
test('version catalog is explicitly labelled and indexes crafting only on demand',()=>{
  const book=new WorldRecipeBook(minecraftData('1.21.1'));book.useVersionCatalog(9);
  assert.equal(book.snapshot().source,'version-catalog');assert.equal(book.snapshot().indexedOutputs,0);
  assert.ok(book.recipesFor('wooden_pickaxe').some(r=>r.executable&&r.cells.length===5));
  assert.equal(book.snapshot().indexedOutputs,1);
});
test('a version profile cannot be accidentally supplied for another requested protocol',()=>{
  assert.throws(()=>new KudoConnect({version:'1.21.1'},{versionProfile:profile()}),/соответствовать версии/);
});
