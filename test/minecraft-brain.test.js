import test from 'node:test';
import assert from 'node:assert/strict';
import { createMinecraftBrain, createCombatReactor, createStorageReactor } from '../mckudo_core.js';
import { KudoConnect } from '../kudoconnect/index.js';
const base = () => ({ dimension:'minecraft:overworld', self:{position:{x:0,y:64,z:0},health:20,freeInventorySlots:36}, entities:[{id:'2',kind:'player',name:'player',username:'Blake',position:{x:2,y:64,z:0}}], combat:{attackers:[]} });
test('two attributed recent hits trigger retaliation against players and managed agents alike', () => {
  const defense = createCombatReactor({attackPlayers:true,clock:()=>20000}), o = base();
  o.combat.attackers = [{entityId:'2',hits:1,hitTimes:[19900],lastHitAt:19900}]; assert.equal(defense.react(o).action,null);
  o.combat.attackers.push({entityId:'3',hits:1,hitTimes:[19950],lastHitAt:19950}); assert.equal(defense.react(o).action,null);
  o.combat.attackers[0] = {entityId:'2',hits:2,hitTimes:[19000,19900],lastHitAt:19900};
  for (const managedAgent of [false,true]) { o.entities[0].managedAgent = managedAgent; assert.equal(defense.react(o).action.args.entityId,'2'); }
  o.combat.attackers[0].hitTimes = [9000,19900]; assert.equal(defense.react(o).action,null);
  o.combat.attackers[0].hitTimes = [19000,19900]; assert.equal(createCombatReactor({attackPlayers:true,trustedPlayers:['bLaKe'],clock:()=>20000}).react(o).action,null);
});
test('storage policy chooses observed nearest chest, respects refresh, health and capacity', () => {
  const r = createStorageReactor({clock:()=>20000}), o = base();
  o.world = {sampledBlocks:[{name:'minecraft:chest',position:{x:8,y:64,z:0}},{name:'minecraft:barrel',position:{x:2,y:64,z:0}}]};
  assert.equal(r.react(o).action.args.x,2);
  o.storage = [{dimension:o.dimension,position:{x:2,y:64,z:0},observedAt:19500,contents:[]}]; assert.equal(r.react(o).action.args.x,8);
  o.self.freeInventorySlots = 0; assert.equal(r.react(o).action,null);
  o.self.freeInventorySlots = 36; o.self.health = 4; assert.equal(r.react(o).action,null);
});
test('standard brain performs retaliation through the adapter with urgent priority', async () => {
  const c = new KudoConnect({username:'Henry'}), calls = [];
  c.state = {...c.state,status:'ready',health:20,food:20,position:{x:0,y:64,z:0},dimension:'minecraft:overworld'};
  c.entities.set(2,{id:'2',kind:'player',name:'player',username:'Blake',position:{x:2,y:64,z:0},velocity:{x:0,y:0,z:0},metadata:{}});
  c.attackers.set('2',{entityId:'2',hits:2,hitTimes:[Date.now()-100,Date.now()],lastHitAt:Date.now()});
  c.world.findBlocks = async()=>({blocks:[],revision:0,truncated:false});
  c.execute = async(action,options)=>{calls.push({action,options});return {ok:true};};
  const brain = createMinecraftBrain({client:c,worldId:'test-world',storage:false});
  await brain.tick(); await brain.stop();
  assert.equal(calls.length,1); assert.equal(calls[0].action.skill,'combat'); assert.equal(calls[0].action.args.allowPlayer,true); assert.equal(calls[0].options.priority,990);
});
