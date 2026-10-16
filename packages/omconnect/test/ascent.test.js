import test from 'node:test';
import assert from 'node:assert/strict';
import {planSafeAscent} from '../src/ascent.js';
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const position={x:0,y:10,z:0},toward={x:10,y:20,z:0};
const mine=p=>p.x===0&&p.z===0&&(p.y===10||p.y===11)?air:stone;
test('ascent clears current overhead before adjacent headroom and never mines the standing support',()=>{
  const plan=planSafeAscent({position,toward,getBlock:mine,canDig:()=>true});assert.equal(plan.action.skill,'dig');assert.deepEqual(plan.action.args,{x:0,y:12,z:0,block:'minecraft:stone'});
  const open=p=>p.x===0&&p.z===0&&p.y===12?air:mine(p);
  const next=planSafeAscent({position,toward,getBlock:open,canDig:()=>true});assert.deepEqual(next.action.args,{x:1,y:12,z:0,block:'minecraft:stone'});
});
test('ascent rejects unknown ceilings, nearby lava, protected excavation and occupied destinations',()=>{
  assert.equal(planSafeAscent({position,toward,getBlock:p=>p.y===12?null:mine(p),canDig:()=>true}),null);
  assert.equal(planSafeAscent({position,toward,getBlock:mine,canDig:()=>false}),null);
  assert.equal(planSafeAscent({position,toward,getBlock:mine,canDig:()=>true,occupied:()=>true}),null);
  const lava=p=>p.x===0&&p.z===0&&p.y===13?{...stone,name:'lava'}:mine(p);
  assert.equal(planSafeAscent({position,toward,getBlock:lava,canDig:()=>true}),null);
});
test('a cleared ascent first prepares missing support with permitted stock, then climbs normally',()=>{
  const open=p=>p.y<10?stone:air;
  assert.equal(planSafeAscent({position,toward,getBlock:open,buildingBlock:'minecraft:dirt',canPlace:()=>false}),null);
  const place=planSafeAscent({position,toward,getBlock:open,buildingBlock:'minecraft:dirt',canPlace:()=>true});assert.equal(place.action.skill,'place');assert.equal(place.action.args.y,10);
  const supported=p=>p.x===1&&p.y===10&&p.z===0?stone:open(p);
  const step=planSafeAscent({position,toward,getBlock:supported});assert.equal(step.action.skill,'navigate');assert.equal(step.action.args.y,11);assert.equal(step.action.args.maxDrop,1);
});
