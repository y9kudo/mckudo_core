import test from 'node:test';
import assert from 'node:assert/strict';
import {KudoConnect} from '../kudoconnect/index.js';
import {createKudoAdapter} from '../adapters/kudoconnect.js';
import {catalogFromMinecraftData,createSurvivalReactor} from '../mckudo_core.js';
test('nearby stone cannot crowd birch and deep iron out of perception or resource planning',async()=>{
  const c=new KudoConnect();Object.assign(c.state,{position:{x:.5,y:1,z:.5},health:20,food:20,dimension:'minecraft:overworld',status:'ready'});
  const birch={name:'minecraft:birch_log',position:{x:8,y:1,z:0},distance:8,properties:{}},iron={name:'minecraft:deepslate_iron_ore',position:{x:8,y:-20,z:2},distance:23,properties:{}};
  const common=Array.from({length:256},(_,i)=>({name:'minecraft:stone',position:{x:i%16,y:0,z:Math.floor(i/16)},distance:1,properties:{}}));
  c.world.findBlocks=async({names})=>({blocks:names.includes('minecraft:stone')?structuredClone(common):names.includes('minecraft:birch_log')?[birch]:names.includes('minecraft:deepslate_iron_ore')?[iron]:[],revision:0,truncated:false});
  c.world.blockAt=p=>c.world.Block.fromStateId(c.registry.blocksByName[Math.floor(p.x)===8&&Math.floor(p.y)===1&&Math.floor(p.z)===0?'birch_log':p.y<1?'stone':'air'].defaultState,0);
  const catalog=catalogFromMinecraftData(c.registry),adapter=createKudoAdapter(c,{catalog,trackedBlocks:['stone','#logs','#ores']}),o=await adapter.observe({signal:c.connectionAbort.signal});
  assert.ok(o.world.sampledBlocks.some(b=>b.name==='minecraft:birch_log'));assert.ok(o.world.sampledBlocks.some(b=>b.name==='minecraft:deepslate_iron_ore'));
  const reactor=createSurvivalReactor({client:c,catalog,targets:{stone_pickaxe:1},exploration:false});reactor.react(o);
  assert.ok(reactor.snapshot().plan.some(p=>p.item==='minecraft:birch_log'));
  assert.equal(reactor.snapshot().plan.some(p=>p.item==='minecraft:oak_log'),false);await c.close();
});
test('basic stone preparation opens local soil instead of chasing an unreachable distant face',()=>{
  const c=new KudoConnect();Object.assign(c.state,{position:{x:.5,y:1,z:.5},health:20,food:20,dimension:'minecraft:overworld',status:'ready'});
  c.world.blockAt=p=>c.world.Block.fromStateId(c.registry.blocksByName[p.x===20&&p.y===0?'stone':p.y<0?'stone':p.y<1?'dirt':'air'].defaultState,0);
  const catalog=catalogFromMinecraftData(c.registry),reactor=createSurvivalReactor({client:c,catalog,targets:{cobblestone:1}});
  const result=reactor.react({dimension:'minecraft:overworld',self:c.state,inventory:{'minecraft:wooden_pickaxe':1},world:{sampledBlocks:[{name:'minecraft:stone',position:{x:20,y:0,z:0}}]}});
  assert.equal(result.action.skill,'dig');assert.equal(result.action.args.block,'minecraft:dirt');assert.ok(Math.hypot(result.action.args.x,result.action.args.z)<2);
});
