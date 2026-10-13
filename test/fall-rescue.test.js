import test from 'node:test';
import assert from 'node:assert/strict';
import {KudoConnect} from '../kudoconnect/index.js';
import {predictFallLanding,planPearlEscape,decideFallRescue} from '../packages/kudoconnect/src/fall-safety.js';

const stone={name:'end_stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const air={name:'air',boundingBox:'empty',shapes:[]};
const island=p=>p.y<=63&&p.x>=6&&p.x<=14&&p.z>=-4&&p.z<=4?stone:air;
const ground=p=>p.y<=63?stone:air;

test('fall prediction separates a reachable surface from an End void',()=>{
  const state={position:{x:8.5,y:75,z:.5},velocity:{x:0,y:-.5,z:0},onGround:false};
  const landing=predictFallLanding(state,island);
  assert.ok(landing);assert.equal(landing.position.y,64);assert.ok(landing.ticks<30);
  assert.equal(predictFallLanding({...state,position:{x:0,y:75,z:.5}},island),null);
});

test('pearl rescue targets only a broad observed island, never unknown or a single pillar',()=>{
  const state={position:{x:0,y:80,z:.5},velocity:{x:0,y:-.25,z:0},onGround:false};
  const plan=planPearlEscape(state,island);
  assert.ok(plan);assert.ok(plan.landing.x>=7&&plan.landing.x<=13);assert.equal(plan.impactBlock.y,63);
  assert.equal(planPearlEscape(state,()=>null),null);
  const pillar=p=>p.x===8&&p.z===0&&p.y<=63?stone:air;
  assert.equal(planPearlEscape(state,pillar),null);
});

test('fall reactor chooses water over ground and a pearl over the void',()=>{
  const state={position:{x:8.5,y:75,z:.5},velocity:{x:0,y:-.5,z:0},onGround:false,health:20,dimension:'minecraft:the_end'};
  assert.equal(decideFallRescue(state,ground,{water_bucket:1,ender_pearl:1},{highestY:78}).skill,'waterClutch');
  const voidState={...state,position:{x:0,y:80,z:.5},velocity:{x:0,y:-.25,z:0}};
  const rescue=decideFallRescue(voidState,island,{ender_pearl:1},{highestY:80});
  assert.equal(rescue.skill,'escapePearl');assert.ok(rescue.plan.ticks<36);
  const knocked={...state,velocity:{x:.8,y:-.3,z:-.8}};
  assert.equal(decideFallRescue(knocked,ground,{water_bucket:1,ender_pearl:1},{highestY:90}).skill,'escapePearl');
  assert.equal(decideFallRescue({...state,onGround:true},ground,{water_bucket:1},{highestY:78}),null);
});

test('normal ladder contact never interrupts a climb to waste an ender pearl',()=>{
  const state={position:{x:98.595,y:52.992,z:1.502},velocity:{x:0,y:-.225,z:0},onGround:false,health:20,dimension:'minecraft:the_end',environment:{contacts:['air','ladder']}};
  assert.equal(decideFallRescue(state,()=>air,{water_bucket:1,ender_pearl:16},{highestY:54}),null);
});

test('KudoConnect dispatches emergency actions at higher priority than movement',async()=>{
  const c=new KudoConnect({username:'Avery07'});const dispatched=[];
  c.state={...c.state,status:'ready',position:{x:8.5,y:75,z:.5},velocity:{x:0,y:-.5,z:0},health:20,onGround:false,dimension:'minecraft:the_end'};
  c.world.blockAt=ground;c.inventory.slots[36]={name:'water_bucket',item:'minecraft:water_bucket',count:1,slot:36};
  c.execute=async(action,options)=>{dispatched.push({action,options});return {ok:true};};
  c.tickFallSafety();await c.fallSafety.active;
  assert.equal(dispatched.length,1);assert.equal(dispatched[0].action.skill,'waterClutch');assert.equal(dispatched[0].options.priority,1500);
});

test('water clutch places and recovers water after confirmed landing',async()=>{
  const c=new KudoConnect({username:'Avery07',fallSafety:false});let water=false;const placements=[];
  c.state={...c.state,status:'ready',position:{x:8.5,y:66.5,z:.5},velocity:{x:0,y:-.5,z:0},health:20,onGround:false,dimension:'minecraft:the_end'};
  c.client={state:'play'};c.world.blockAt=p=>p.y===64&&water?{name:'water',boundingBox:'empty',shapes:[]}:ground(p);
  c.inventory.slots[36]={name:'water_bucket',item:'minecraft:water_bucket',count:1,slot:36};
  c.write=(name,packet)=>{
    if(name!=='block_place')return;
    placements.push(packet);
    if(!water){water=true;c.inventory.slots[36]={name:'bucket',item:'minecraft:bucket',count:1,slot:36};queueMicrotask(()=>{c.emit('block',{});c.state.onGround=true;c.emit('physics',c.state.position);});}
    else{water=false;c.inventory.slots[36]={name:'water_bucket',item:'minecraft:water_bucket',count:1,slot:36};queueMicrotask(()=>c.emit('inventory',{}));}
  };
  const result=await c.execute({skill:'waterClutch'});
  assert.equal(result.waterPlaced,true);assert.equal(result.recovered,true);
  assert.equal(placements.length,2);assert.deepEqual(placements[0].location,{x:8,y:63,z:0});
});

test('emergency pearl action sends one use packet only after a checked landing exists',async()=>{
  const c=new KudoConnect({username:'Avery07',fallSafety:false});const packets=[];
  c.state={...c.state,status:'ready',position:{x:0,y:80,z:.5},velocity:{x:0,y:-.25,z:0},health:20,onGround:false,dimension:'minecraft:the_end'};
  c.client={state:'play'};c.world.blockAt=island;
  c.inventory.slots[36]={name:'ender_pearl',item:'minecraft:ender_pearl',count:2,slot:36};
  c.write=(name,packet)=>{packets.push({name,packet});if(name==='use_item'){c.inventory.slots[36].count--;queueMicrotask(()=>c.emit('inventory',{}));}};
  const result=await c.execute({skill:'escapePearl'});
  assert.equal(result.thrown,true);assert.equal(result.landingConfirmed,false);
  assert.equal(packets.filter(p=>p.name==='use_item').length,1);
  c.world.blockAt=()=>null;
  await assert.rejects(c.execute({skill:'escapePearl'}),/площадки/);
  assert.equal(packets.filter(p=>p.name==='use_item').length,1);
});
