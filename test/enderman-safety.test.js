import test from 'node:test';
import assert from 'node:assert/strict';
import {KudoConnect} from '../kudoconnect/index.js';
import {createCombatReactor} from '../mckudo_core.js';
import {endermanGazeRisk} from '../packages/kudoconnect/src/enderman-gaze.js';

const enderman={id:'7',name:'enderman',kind:'entity',position:{x:8,y:64,z:0},metadata:{},velocity:{x:0,y:0,z:0}};

test('every intermediate look frame avoids observed Enderman eyes',()=>{
  const c=new KudoConnect({username:'Avery07'});
  c.state.position={x:0,y:64,z:0};c.state.yaw=0;c.state.pitch=0;
  c.entities.set(7,{...enderman});
  c.lookAt({x:0,y:65.62,z:-12});
  for(let i=0;i<120;i++){
    c.tickLook(.05);
    assert.equal(endermanGazeRisk(c.state,c.state,c.entities.values()),null,`unsafe look at frame ${i}`);
  }
  assert.equal(c.look.target,null);
});

test('direct look target is pitched away while retaining horizontal bearing',()=>{
  const c=new KudoConnect({username:'Avery07'});
  c.state.position={x:0,y:64,z:0};
  c.entities.set(7,{...enderman});
  c.lookAt({x:8,y:66.55,z:0});
  for(let i=0;i<80&&c.look.target;i++)c.tickLook(.05);
  assert.equal(c.look.target,null);
  assert.equal(endermanGazeRisk(c.state,c.state,c.entities.values()),null);
  assert.ok(Math.abs(c.state.yaw+90)<1);
});

test('Enderman retaliation uses water once, then sword combat; passive ones are ignored',()=>{
  let now=10000;const r=createCombatReactor({clock:()=>now});
  const o={dimension:'minecraft:the_end',self:{position:{x:0,y:64,z:0},health:20},inventory:{'minecraft:water_bucket':1},entities:[{...enderman,position:{x:2,y:64,z:0}}],combat:{attackers:[]}};
  assert.equal(r.react(o).action,null);
  o.combat.attackers=[{entityId:'7',hits:1,lastHitAt:now,hitTimes:[now]}];
  const first=r.react(o).action;assert.equal(first.skill,'waterGuard');
  r.recordResult({outcome:'success'},first);
  assert.equal(r.react(o).action.skill,'combat');
  now+=10001;
  o.combat.attackers[0]={entityId:'7',hits:1,lastHitAt:now,hitTimes:[now]};
  assert.equal(r.react(o).action.skill,'waterGuard');
});

test('water guard places a source under the agent only with a verified support',async()=>{
  const c=new KudoConnect({username:'Avery07'});let water=false;const packets=[];
  c.state={...c.state,status:'ready',position:{x:2.5,y:64,z:3.5},health:20,dimension:'minecraft:the_end'};
  c.inventory.slots[36]={name:'water_bucket',item:'minecraft:water_bucket',type:1,count:1,slot:36};
  c.world.blockAt=p=>p.y===63?{name:'end_stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]}:p.y===64&&water?{name:'water',boundingBox:'empty',shapes:[]}:{name:'air',boundingBox:'empty',shapes:[]};
  c.lookAt=()=>{};c.waitForLook=async()=>{};
  c.write=(name,packet)=>{packets.push({name,packet});if(name==='block_place'){water=true;queueMicrotask(()=>c.emit('block',{}));}};
  assert.equal((await c.execute({skill:'waterGuard'})).serverConfirmed,true);
  assert.equal(packets.filter(p=>p.name==='block_place').length,1);
  assert.deepEqual(packets.find(p=>p.name==='block_place').packet.location,{x:2,y:63,z:3});
  assert.equal((await c.execute({skill:'waterGuard'})).alreadyProtected,true);
  assert.equal(packets.filter(p=>p.name==='block_place').length,1);
});
