import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createEquipmentReactor,createNightReactor,createHuntingReactor,createSurvivalReactor,diamondSetTargets,diamondSetCondition,matches,catalogFromMinecraftData} from '../mckudo_core.js';
import {KudoConnect} from '../kudoconnect/index.js';
import {readSlot} from '../packages/kudoconnect/src/inventory.js';
import {planRoute} from '../src/navigation.js';
import {personalSpaceControl} from '../packages/kudoconnect/src/movement.js';
import {equipmentTradeTargets,unequippedTargets} from '../src/equipment-policy.js';
import {proposeTrade} from '../src/item-value.js';
const c=new KudoConnect(),registry=c.registry;

test('sharing preserves diamonds for missing equipment and accounts for worn armor once',()=>{
  const from=new KudoConnect(),to=new KudoConnect(),raw=name=>({itemCount:1,itemId:registry.itemsByName[name].id,components:[],removeComponents:[]});
  from.inventory.slots[5]=readSlot(raw('diamond_helmet'),registry,5);
  from.inventory.slots[36]=readSlot({...raw('diamond'),itemCount:40},registry,36);
  const goals={'minecraft:diamond_helmet':2,'minecraft:diamond_chestplate':1};
  const reserved=equipmentTradeTargets(from,goals);
  assert.equal(reserved['minecraft:diamond'],13);
  const adjusted=unequippedTargets(from,reserved);assert.equal(adjusted['minecraft:diamond_helmet'],1);
  const recipient=equipmentTradeTargets(to,{'minecraft:diamond_helmet':1});
  const gift=proposeTrade({from:from.inventory.snapshot(),to:{},fromTargets:adjusted,toTargets:recipient});
  assert.equal(gift.kind,'gift');assert.deepEqual(gift.give,[{item:'minecraft:diamond',count:5}]);
});
const base=()=>({dimension:'minecraft:overworld',self:{position:{x:.5,y:1,z:.5},health:20,food:20,freeInventorySlots:36},inventory:{},equipment:{},entities:[],world:{sampledBlocks:[]},time:{timeOfDay:14000}});
test('equipped armor satisfies ownership and survival goal without crafting duplicates',()=>{
  const o=base();o.inventory=diamondSetTargets();
  for(const [slot,part] of Object.entries({head:'helmet',chest:'chestplate',legs:'leggings',feet:'boots'})){const item='minecraft:diamond_'+part;delete o.inventory[item];o.equipment[slot]={item,count:1};}
  const r=createSurvivalReactor({catalog:catalogFromMinecraftData(registry)});assert.equal(r.react(o).action,null);assert.equal(r.snapshot().status,'completed');assert.equal(matches(diamondSetCondition(),o),true);
  o.inventory['minecraft:iron_helmet']=1;assert.equal(createEquipmentReactor().react(o).action,null);
  o.inventory['minecraft:netherite_helmet']=1;assert.equal(createEquipmentReactor().react(o).action.args.item,'minecraft:netherite_helmet');
});
test('armor swap awaits both authoritative slots and preserves old armor',async()=>{
  const x=new KudoConnect();Object.assign(x.state,{status:'ready',health:20});
  const raw=name=>({itemCount:1,itemId:registry.itemsByName[name].id,components:[],removeComponents:[]});
  x.inventory.slots[36]=readSlot(raw('diamond_helmet'),registry,36);x.inventory.slots[5]=readSlot(raw('iron_helmet'),registry,5);
  x.client={state:'play',write(name,p){if(name==='window_click'){assert.equal(p.slot,5);const a=x.inventory.slots[5],b=x.inventory.slots[36];x.inventory.slots[5]={...b,slot:5};x.inventory.slots[36]={...a,slot:36};x.inventory.revision++;x.emit('inventory');}}};
  const result=await x.execute({skill:'equipArmor',args:{item:'diamond_helmet'}});
  assert.equal(result.serverConfirmed,true);assert.equal(x.inventory.equipment().head.name,'diamond_helmet');assert.equal(x.inventory.count('diamond_helmet'),0);assert.equal(x.inventory.ownedCount('diamond_helmet'),1);assert.equal(x.inventory.held().name,'iron_helmet');
});
test('night failure yields to work, daylight and unsafe dimensions never request sleep',()=>{
  let now=1000;const r=createNightReactor({clock:()=>now}),o=base(),core=new EventEmitter();r.attach(core);
  assert.equal(r.react(o).action,null);o.world.sampledBlocks=[{name:'minecraft:white_bed',position:{x:2,y:1,z:0},properties:{occupied:false}}];
  assert.equal(r.react(o).action.skill,'sleep');core.emit('action:start',{id:r.id,action:r.react(o).action});core.emit('action:finish',{rule:r.id,outcome:'failure'});assert.equal(r.react(o).action,null);
  now+=61000;assert.equal(r.react(o).action.skill,'sleep');o.dimension='minecraft:the_nether';assert.equal(r.react(o).action,null);o.dimension='minecraft:overworld';o.time.timeOfDay=1000;assert.equal(r.react(o).action,null);
});

test('hunting paths to distant prey and yields after an unreachable route',()=>{
  let now=0;const core=new EventEmitter(),r=createHuntingReactor({targets:{leather:1},foodReserve:0,prepareWool:false,clock:()=>now}),o=base();r.attach(core);
  o.entities=[{id:'7',name:'cow',kind:'entity',position:{x:10,y:2,z:3}}];
  const decision=r.react(o);assert.equal(decision.action.skill,'navigate');assert.equal(decision.action.args.bridge,false);
  core.emit('action:start',{id:r.id,action:decision.action});core.emit('action:finish',{rule:r.id,outcome:'failure'});
  assert.equal(r.react(o).action,null);now=10001;assert.equal(r.react(o).action.skill,'navigate');
});
test('night prepares only a bed or three matching wool; hunting excludes children, named and sheared wool sources',()=>{
  const o=base(),night=createNightReactor();o.inventory={'minecraft:white_wool':2,'minecraft:black_wool':1};assert.equal(night.react(o).action,null);o.inventory['minecraft:white_wool']=3;assert.equal(night.react(o).action.skill,'prepareBed');
  const hunt=createHuntingReactor({targets:{leather:1},foodReserve:0,prepareWool:false});o.entities=[{id:'1',name:'cow',kind:'entity',position:{x:2,y:1,z:0},isBaby:true},{id:'2',name:'cow',kind:'entity',position:{x:3,y:1,z:0},named:true},{id:'3',name:'cow',kind:'entity',position:{x:3,y:1,z:0}}];assert.equal(hunt.react(o).action.args.entityId,'3');o.inventory['minecraft:leather']=1;assert.equal(hunt.react(o).action,null);
  const wool=createHuntingReactor({targets:{},foodReserve:0});o.inventory={};o.entities=[{id:'4',name:'sheep',kind:'entity',woolColor:0,sheared:true,position:{x:2,y:1,z:0}}];assert.equal(wool.react(o).action,null);o.entities[0].sheared=false;assert.equal(wool.react(o).action.args.entityId,'4');
});
const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]},flat=p=>p.y<1?stone:air;
test('diagonal routes shorten open ground while preventing corner cutting and occupied cells',()=>{
  const args={start:{x:0,y:1,z:0},goal:{x:5,y:1,z:5},getBlock:flat};const route=planRoute(args);assert.equal(route.steps.length,5);assert.ok(Math.abs(route.cost-5*Math.SQRT2)<1e-8);
  const guarded=planRoute({...args,getBlock:p=>p.x===1&&p.z===0&&p.y===1?stone:flat(p),occupied:p=>p.x===2&&p.z===2});assert.equal(guarded.status,'planned');assert.ok(!guarded.steps.some(s=>s.position.x===2&&s.position.z===2));assert.notDeepEqual(guarded.steps[0].position,{x:1,y:1,z:1});
});
test('personal space sidesteps a player and separates identical positions without sprinting',()=>{
  const s={...base().self,position:{x:.5,y:1,z:.5},onGround:true},control={x:1,z:0,sprint:true,jump:true};
  const result=personalSpaceControl(s,control,[{kind:'player',id:'2',position:{x:1.4,y:1,z:.5}}],flat,'1');assert.equal(result.sprint,false);assert.equal(result.jump,false);assert.ok(result.z!==0||result.x<=0);
  const a=personalSpaceControl(s,{...control,x:0},[{kind:'player',id:'2',position:s.position}],flat,'1'),b=personalSpaceControl(s,{...control,x:0},[{kind:'player',id:'1',position:s.position}],flat,'2');assert.ok(a.x*b.x<0);
});
