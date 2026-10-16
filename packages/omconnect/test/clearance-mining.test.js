import test from 'node:test';
import assert from 'node:assert/strict';
import {OMConnect,chooseMiningTool} from '../index.js';
import {runAction} from '../src/actions.js';
test('clearance can break without harvesting, while ordinary resource mining still requires a usable tool',async()=>{
  const c=new OMConnect(),source=c.registry.blocksByName.stone,block={...source,name:'stone',diggable:true,hardness:.01,shapes:[[0,0,0,1,1,1]],stateId:source.defaultState};let gone=false;const packets=[];
  Object.assign(c.state,{status:'ready',health:20,food:20,onGround:true,position:{x:.5,y:1,z:.5}});
  const isTarget=p=>p.x===1&&p.y===1&&p.z===0;
  c.world.blockAt=p=>isTarget(p)&&!gone?block:p.y<1?block:{name:'air',boundingBox:'empty',shapes:[],stateId:0};
  c.world.stateAt=p=>isTarget(p)&&!gone?source.defaultState:0;c.waitForLook=async()=>{};
  c.client={state:'play',end(){},write(name,p){packets.push({name,p});if(name==='block_dig'&&p.status===2){gone=true;c.emit('block');}}};
  try{
    assert.equal(chooseMiningTool(c.registry,block,[]),null);
    assert.equal(chooseMiningTool(c.registry,block,[],{requireHarvest:false}).harvestable,false);
    await assert.rejects(runAction(c,{skill:'dig',args:{x:1,y:1,z:0}},new AbortController().signal),/tool/);
    assert.equal(packets.some(p=>p.name==='block_dig'),false);
    const result=await runAction(c,{skill:'dig',args:{x:1,y:1,z:0,dropRequired:false}},new AbortController().signal);
    assert.equal(result.serverConfirmed,true);assert.equal(result.harvestable,false);assert.deepEqual(c.inventory.snapshot(),{});
    assert.ok(packets.some(p=>p.name==='block_dig'&&p.p.status===2));
  }finally{await c.close();}
});
