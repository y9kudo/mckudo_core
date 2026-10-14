import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFall,planRoute} from '../index.js';
const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
test('fall estimates preserve health reserve and ordinary armor cannot remove damage',()=>{
  for(const height of [1,2,3])assert.equal(assessFall({height,landing:stone}).estimatedDamage,0);
  assert.equal(assessFall({height:7,health:12,landing:stone}).healthAfter,8);
  assert.equal(assessFall({height:7,health:6,landing:stone}).allowed,false);
  assert.equal(assessFall({height:23,health:20,landing:stone,maxDamage:30,minHealthAfter:0}).survivable,false);
  assert.equal(assessFall({height:20,landing:{...stone,name:'hay_block'}}).estimatedDamage,4);
  for(const name of ['lava','magma_block','water','slime_block'])assert.equal(assessFall({height:1,landing:{...stone,name}}).allowed,false);
  assert.equal(assessFall({height:1,landing:null}).allowed,false);
});
test('route accepts a survivable deep descent and rejects it at low health or unknown landing',()=>{
  const terrain=p=>p.z!==0?stone:p.y<(p.x<=0?7:1)?stone:air;
  const options={start:{x:0,y:7,z:0},goal:{x:1,y:1,z:0},getBlock:terrain,maxDrop:16,maxNodes:100};
  const good=planRoute({...options,fallPolicy:{health:20,minHealthAfter:6}});
  assert.equal(good.status,'planned');assert.equal(good.fallDamage,3);assert.equal(good.steps[0].fall.healthAfter,17);
  assert.equal(planRoute({...options,fallPolicy:{health:8,minHealthAfter:6}}).status,'blocked');
  assert.equal(planRoute({...options,getBlock:p=>p.x>0&&p.y===0?null:terrain(p)}).status,'blocked');
});
