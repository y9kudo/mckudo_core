import test from 'node:test';
import assert from 'node:assert/strict';
import { traceVisibility } from '../index.js';
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const origin={x:.5,y:65.62,z:.5},target={x:5.5,y:65,z:.5};

test('visibility is blocked by real voxel shapes and by unknown chunks',()=>{
  assert.equal(traceVisibility({origin,target,getBlock:()=>air}).visible,true);
  const wall=p=>p.x===2?stone:air;
  const blocked=traceVisibility({origin,target,getBlock:wall});assert.equal(blocked.reason,'blocked');assert.equal(blocked.position.x,2);
  assert.equal(traceVisibility({origin,target,getBlock:p=>p.x===2?null:air}).reason,'unloaded');
  assert.equal(traceVisibility({origin,target:{...target,x:200},getBlock:()=>air}).reason,'too-far');
});

test('visibility traces thin shapes exactly and leaves open space above a slab visible',()=>{
  const pane={name:'glass_pane',boundingBox:'block',shapes:[[.49,0,0,.51,1,1]]};
  assert.equal(traceVisibility({origin,target,getBlock:p=>p.x===2?pane:air}).visible,false);
  const slab={name:'stone_slab',boundingBox:'block',shapes:[[0,0,0,1,.5,1]]};
  assert.equal(traceVisibility({origin:{x:.5,y:65.75,z:.5},target:{x:5.5,y:65.75,z:.5},getBlock:p=>p.x===2?slab:air}).visible,true);
  assert.equal(traceVisibility({origin:{x:.5,y:65.25,z:.5},target:{x:5.5,y:65.25,z:.5},getBlock:p=>p.x===2?slab:air}).visible,false);
});

test('visibility handles diagonal crossings, negative coordinates and a zero length segment',()=>{
  assert.equal(traceVisibility({origin:{x:-.5,y:2,z:-.5},target:{x:-5.5,y:2,z:-5.5},getBlock:()=>air}).visible,true);
  assert.equal(traceVisibility({origin,target:origin,getBlock:()=>air}).visible,true);
  assert.throws(()=>traceVisibility({origin:{x:NaN,y:0,z:0},target,getBlock:()=>air}),/Visibility/);
});

test('a ray parallel to an integer voxel boundary checks both adjacent walls',()=>{
  const air={name:'air',boundingBox:'empty',shapes:[]},wall={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  for(const side of[0,-1]){
    const read=p=>p.x===2&&p.z===side?wall:air;
    const result=traceVisibility({origin:{x:.5,y:65.5,z:0},target:{x:5.5,y:65.5,z:0},getBlock:read});
    assert.equal(result.visible,false);assert.equal(result.reason,'blocked');
  }
  assert.equal(traceVisibility({origin:{x:.5,y:65.5,z:0},target:{x:5.5,y:65.5,z:0},getBlock:p=>p.z===-1?null:air}).reason,'unloaded');
});
