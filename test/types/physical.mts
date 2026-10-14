import {createPPO,createSAC,createPhysicalEnvironment,createVectorEnvironment,createOMRLBridge,PHYSICAL_FEATURES,PHYSICAL_ACTIONS} from 'overmindmc/intelligence';
import {createVersionAPI,registerVersionProfile,OMConnect,OMVectorize} from 'overmindmc/connect';
const config={inputs:PHYSICAL_FEATURES.length,actions:PHYSICAL_ACTIONS.length};
const ppo=createPPO(config),sac=createSAC(config),env=createPhysicalEnvironment({spawn:{x:.5,y:7,z:.5}});env.reset();env.setBlock({x:0,y:1,z:0},'water');
const pool=createVectorEnvironment({count:128,environment:{kind:'physical',mobs:2}});const states=await pool.reset();await pool.step(states.map(s=>ppo.act(s.observation,{mask:s.actionMask})));await pool.close();
const client=new OMConnect({version:'1.21.1',username:'Atlas'});createOMRLBridge({client,policy:ppo,goal:{x:1,y:64,z:4},axis:'south'});createOMRLBridge({client,policy:sac,goal:{x:1,y:64,z:4}});
const api=createVersionAPI('1.16.5');api.capabilities();api.movement({position:{x:0,y:64,z:0},yaw:0,pitch:0,onGround:true});registerVersionProfile({version:'custom',loadRegistry:()=>({}),createProtocolClient:()=>({})});
new OMVectorize({getBlock:()=>null,getRevision:()=>0});
