import test from 'node:test';
import assert from 'node:assert/strict';
import {fillEndFrame,ignitePortal,enterPortal} from '../src/portals.js';

test('End frame insertion waits for a server block update, not just the click',async()=>{
  let eye=false,waited=false;const packets=[];
  const c={state:{dimension:'minecraft:overworld'},world:{blockAt:()=>({name:'end_portal_frame',getProperties:()=>({eye})})},sequence:0,
    stopMovement(){},lookAt(){},waitForLook:async()=>{},write:(n,p)=>packets.push({n,p}),waitFor:async check=>{assert.equal(check(),false);eye=true;assert.equal(check(),true);waited=true;}};
  const selected=[];const runtime={approach:async()=>{},select:async(c,n)=>selected.push(n)};
  const r=await fillEndFrame(c,{x:1,y:64,z:2},new AbortController().signal,runtime);
  assert.equal(r.serverConfirmed,true);assert.equal(waited,true);assert.deepEqual(selected,['ender_eye']);assert.equal(packets[0].n,'block_place');
});
test('portal actions reject unknown frames and inactive entrances without sending packets',async()=>{
  const c={state:{dimension:'minecraft:overworld'},world:{blockAt:()=>null},write:()=>assert.fail('No packet expected')},signal=new AbortController().signal;
  await assert.rejects(ignitePortal(c,{origin:{x:0,y:0,z:0}},signal,{}),/рама/);
  await assert.rejects(enterPortal(c,{x:0,y:0,z:0,dimension:'minecraft:the_end'},signal,{}),/не наблюдается/);
});
