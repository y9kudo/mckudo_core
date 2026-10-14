import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombatReactor} from '../src/combat.js';
import {planRetreatExcavation} from '../packages/omconnect/src/retreat.js';
import {createSurvivalReactor,catalogFromMinecraftData} from '../overmindmc.js';
import {OMConnect} from '../omconnect/index.js';
import {createCore} from '../src/core.js';

const air={name:'air',boundingBox:'empty',shapes:[]},solid=name=>({name,boundingBox:'block',shapes:[[0,0,0,1,1,1]],hardness:1,diggable:true});
test('combat shoots a flying attacker, seeks cover without arrows and never melees an unreachable flyer',()=>{
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20},inventory:{'minecraft:bow':1,'minecraft:arrow':12},entities:[{id:'9',name:'phantom',hostile:true,visible:true,position:{x:4,y:69,z:0}}]};const r=createCombatReactor({pathRetreat:true});assert.equal(r.react(o).action.skill,'shoot');delete o.inventory['minecraft:arrow'];const cover=r.react(o).action;assert.equal(cover.skill,'evade');assert.equal(cover.args.seekCover,true);assert.equal(createCombatReactor().react(o).action,null);
});

test('retreat excavation opens only short known terrain paths away from the threat',()=>{
  const world=p=>p.y<64?solid('stone'):p.x===1&&p.z===0&&p.y===64?solid('dirt'):p.x===1&&p.y>64?air:p.y===64?solid('stone'):air;
  const options={position:{x:.5,y:64,z:.5},from:{x:-5,y:64,z:.5},getBlock:world,canDig:b=>b.name==='dirt',miningMs:()=>500};const plan=planRetreatExcavation(options);assert.ok(plan);assert.deepEqual(plan.dig,[{x:1,y:64,z:0}]);assert.equal(planRetreatExcavation({...options,canDig:()=>false}),null);assert.equal(planRetreatExcavation({...options,miningMs:()=>3000}),null);assert.equal(planRetreatExcavation({...options,from:{x:0,y:64,z:0}}),null);
  assert.equal(planRetreatExcavation({...options,getBlock:p=>p.x===2&&p.y===64?solid('lava'):world(p)}),null);
});

test('exposed nearby hillside stone is chosen immediately and repeated geometry reads are cached per decision',async()=>{
  const c=new OMConnect();Object.assign(c.state,{position:{x:.5,y:64,z:.5},health:20,food:20,status:'ready',dimension:'minecraft:overworld'});let reads=0;const source={x:6,y:64,z:0};c.world.blockAt=p=>{reads++;return c.world.Block.fromStateId(c.registry.blocksByName[p.x===6&&p.y===64&&p.z===0?'stone':p.y<64?'dirt':'air'].defaultState,0);};
  const reactor=createSurvivalReactor({client:c,catalog:catalogFromMinecraftData(c.registry),targets:{cobblestone:1}});const o={dimension:c.state.dimension,self:c.state,inventory:{'minecraft:wooden_pickaxe':1},world:{sampledBlocks:[{name:'minecraft:stone',position:source}]}};const result=reactor.react(o);assert.equal(result.action.skill,'dig');assert.equal(result.action.args.block,'minecraft:stone');assert.deepEqual({x:result.action.args.x,y:result.action.args.y,z:result.action.args.z},source);assert.ok(reads<2500,`geometry reads ${reads}`);await c.close();
});

test('core measures observation, decision and execution separately without conflating action time with CPU planning',async()=>{
  const reactor={id:'test:timing',apiVersion:1,react:()=>({priority:1,reason:'timing',action:{skill:'wait',args:{}}})};const core=createCore({config:{schemaVersion:4,name:'Timings',worldId:'timings',rules:[]},reactors:[reactor],adapter:{describe:()=>({protocolVersion:1,skills:['wait']}),observe:async()=>({self:{health:20}}),execute:async()=>({ok:true})}});
  try{await core.tick();const t=core.snapshot().performance;for(const name of ['observe','test:timing','execute']){assert.equal(t[name].calls,1);assert.ok(t[name].lastMs>=0);assert.equal(t[name].totalMs,t[name].lastMs);} }finally{await core.stop();}
});
