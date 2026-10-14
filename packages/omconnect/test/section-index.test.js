import test from 'node:test';
import assert from 'node:assert/strict';
import {OMSectionIndex} from '../src/section-index.js';

test('different resource selectors share a voxel read; revision changes invalidate only the edited column',()=>{
  let reads=0,id=42;const make=()=>({getBlockStateId:p=>{reads++;return p.x===2&&p.y===4&&p.z===3?id:0;}}),a=make(),b=make(),index=new OMSectionIndex(),base={x:0,y:0,z:0};
  const first=index.query(a,base,0,new Set([42]));assert.deepEqual(first.matches,[{stateId:42,x:2,y:4,z:3}]);assert.equal(first.stateReads,4096);
  assert.equal(index.query(a,base,0,new Set([11])).matches.length,0);assert.equal(reads,4096);
  index.query(b,base,0,new Set([42]));id=11;assert.equal(index.query(a,base,1,new Set([42])).matches.length,0);assert.equal(index.query(b,base,0,new Set([42])).matches.length,1);assert.equal(reads,12288);
});
test('section cache is bounded and immutable matches cannot corrupt subsequent observations',()=>{
  const index=new OMSectionIndex({maxSections:2,maxSelectors:2}),column={getBlockStateId:()=>1};
  for(let y=0;y<160;y+=16)index.query(column,{x:16,y,z:-32},0,new Set([1]));assert.equal(index.snapshot().sections,2);assert.equal(index.snapshot().stateBytes,32768);
  const matches=index.query(column,{x:16,y:144,z:-32},0,new Set([1])).matches;assert.throws(()=>matches.pop());assert.throws(()=>{matches[0].x=0;});index.clear();assert.equal(index.snapshot().sections,0);
});
