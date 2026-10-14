import test from 'node:test';
import assert from 'node:assert/strict';
import {runAction} from '../src/actions.js';

const air={name:'air',boundingBox:'empty',shapes:[]};
const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};

test('evade takes a safe local step when a narrow passage has no full retreat route',async()=>{
  const controls=[];
  const c={state:{status:'ready',health:5,food:12,onGround:true,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}},
    entities:new Map(),world:{revision:0,blockAt:p=>p.y<1&&p.x>=0&&p.x<=2&&p.z===0?stone:air},
    set control(value){controls.push(value);},stopMovement(){controls.push({x:0,z:0,jump:false,sprint:false});}};
  const result=await runAction(c,{skill:'evade',args:{from:{x:-2,y:1,z:.5}}},new AbortController().signal);
  assert.equal(result.emergencyStep,true);
  assert.ok(controls.some(v=>v.x>0&&!v.sprint));
  assert.equal(controls.at(-1).x,0);
});
test('close creeper triggers immediate sprint rather than waiting for A*',async()=>{
  const controls=[];
  const c={state:{status:'ready',health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5},velocity:{x:0,y:0,z:0}},
    entities:new Map([[7,{id:'7',name:'creeper',position:{x:-2,y:1,z:.5}}]]),world:{revision:0,blockAt:p=>p.y<1?stone:air},
    set control(value){controls.push(value);},stopMovement(){controls.push({x:0,z:0,jump:false,sprint:false});}};
  const result=await runAction(c,{skill:'evade',args:{from:{x:-2,y:1,z:.5},entityId:'7'}},new AbortController().signal);
  assert.equal(result.emergencyStep,true);
  assert.ok(controls.some(v=>v.x>0&&v.sprint));
});
