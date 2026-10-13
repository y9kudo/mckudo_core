import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import minecraftData from 'minecraft-data';
import blockLoader from 'prismarine-block';
import {stepPhysics} from '../packages/kudoconnect/src/physics.js';
import {chooseMiningTool} from '../packages/kudoconnect/src/equipment.js';
import {planCreativeFlightRoute} from '../packages/kudoconnect/src/creative-flight.js';
import {createVisionSnapshot} from '../src/vision.js';
import {createTaskQueue} from '../src/task-queue.js';

const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},air={name:'air',boundingBox:'empty',shapes:[]};
test('Creative flight climbs without gravity and stops at known collision',()=>{
  const world=p=>p.y<0?stone:air;
  let state={position:{x:.5,y:0,z:.5},velocity:{x:0,y:0,z:0},yaw:0,pitch:0,onGround:true,health:20,food:20,allowFlying:true,creativeFlying:true,gameMode:'creative',flyingSpeed:.05};
  for(let i=0;i<20;i++)state=stepPhysics(state,{x:0,z:0,up:true},world);
  assert.ok(state.position.y>2);
  const top=state.position.y;
  for(let i=0;i<20;i++)state=stepPhysics(state,{x:0,z:0},world);
  assert.ok(state.position.y>top-.6,'hovering must not fall as in Survival');
  for(let i=0;i<100;i++)state=stepPhysics(state,{x:0,z:0,down:true},world);
  assert.ok(state.position.y>=0&&state.position.y<.1);
});

test('Creative route enters a room through an opening instead of crossing its wall',()=>{
  const clear=p=>!(p.x>=2&&p.x<3&&p.y<3&&Math.abs(p.z)<1.5);
  const route=planCreativeFlightRoute({x:.5,y:0,z:.5},{x:4,y:0,z:0},clear);
  assert.ok(route?.length>5);
  assert.deepEqual(route.at(-1),{x:4,y:0,z:0});
  assert.ok(route.every(p=>clear({x:p.x+.5,y:p.y,z:p.z+.5})));
});

test('soil is mined by shovel or hand, never spends a held pickaxe',()=>{
  const registry=minecraftData('1.21.1'),Block=blockLoader(registry),dirt=Block.fromStateId(registry.blocksByName.dirt.minStateId,0);
  const pick={name:'iron_pickaxe',type:registry.itemsByName.iron_pickaxe.id,slot:36,raw:{components:[]}};
  const shovel={name:'iron_shovel',type:registry.itemsByName.iron_shovel.id,slot:37,raw:{components:[]}};
  assert.equal(chooseMiningTool(registry,dirt,[pick],{held:pick}).item,null);
  assert.equal(chooseMiningTool(registry,dirt,[pick,shovel],{held:pick}).item.name,'iron_shovel');
});

test('vision map distinguishes unloaded chunks from observed terrain',()=>{
  const c={state:{position:{x:.5,y:1,z:.5},yaw:0,pitch:0,dimension:'minecraft:overworld'},options:{viewDistance:24},world:{columns:new Map([['0,0',{}]]),columnAt:p=>p.x>=0&&p.z>=0?{}:null,blockAt:p=>p.y===0?stone:air},entities:new Map([[1,{name:'cow',kind:'mob',position:{x:1,y:1,z:1}}]])};
  const v=createVisionSnapshot(c,{radius:2,down:2,up:2});
  assert.equal(v.cells.find(c=>c.dx===-1&&c.dz===0).category,'unknown');
  assert.equal(v.cells.find(c=>c.dx===1&&c.dz===1).name,'minecraft:stone');
  assert.equal(v.entities[0].name,'cow');
});

test('parallel intentions interleave while only one body action is active',()=>{
  const tasks=['a','b'].map(id=>({id,title:id,type:'scenario',mode:'parallel',scenario:{schemaVersion:1,name:id,steps:[{id:'one',type:'resources',targets:{'minecraft:stone':1}}]}}));
  const q=createTaskQueue({tasks,scenarioFactory:()=>({reactor:{react:()=>({action:{skill:'wait',args:{durationMs:1}},priority:20,reason:'working'})},snapshot:()=>({status:'running'})})}),brain=new EventEmitter();q.attach(brain);
  const first=q.reactor.react({});assert.equal(first.action.skill,'wait');
  brain.emit('action:start',{id:'mckudo:tasks',action:first.action});
  assert.equal(q.reactor.react({}).action,null);
  brain.emit('action:finish',{rule:'mckudo:tasks',outcome:'success'});
  q.reactor.react({});
  assert.equal(q.snapshot().find(s=>s.status==='running').id,'b');
});
