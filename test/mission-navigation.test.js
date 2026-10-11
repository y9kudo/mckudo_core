import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { defineMission, validateScenario, createScenario, catalogFromMinecraftData, planRoute } from '../mckudo_core.js';
import { KudoConnect } from '../kudoconnect/index.js';
import { createNavigationGoal } from '../src/navigation-goal.js';

const air={name:'air',boundingBox:'empty',shapes:[]}, stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
function fixture(terrain,items=[]) {
  const client=new KudoConnect();
  const catalog=catalogFromMinecraftData(client.registry);
  client.world={blockAt:terrain,revision:0};client.inventory.items=()=>items;
  Object.assign(client.state,{position:{x:.5,y:101,z:.5},status:'ready',health:20,onGround:true,dimension:'minecraft:overworld'});
  const observation=()=>({self:{...client.state},dimension:client.state.dimension,inventory:Object.fromEntries(items.filter(i=>i.count).map(i=>['minecraft:'+i.name,i.count]))});
  return {client,catalog,observation};
}
async function planned(controller){for(let i=0;i<100&&controller.snapshot().planning;i++)await tick();assert.equal(controller.snapshot().planning,false);}

test('friendly missions compile class goals, recipe goals and explicit navigation with strict errors',()=>{
  const input=[{get:'#logs',count:8},{craft:'stone_pickaxe'},{go:{x:20,y:64,z:-5},bridge:true}];
  const mission=defineMission(input);
  assert.deepEqual(mission.steps[0].targets,{'#logs':8});
  assert.deepEqual(mission.steps[1].targets,{'minecraft:stone_pickaxe':1});
  assert.deepEqual(mission.steps[2],{id:'step_3',type:'navigate',position:{x:20,y:64,z:-5},bridge:true});
  input[0].count=99;assert.equal(mission.steps[0].targets['#logs'],8);
  for(const bad of [[{get:'logs',craft:'axe'}],[{get:'oak_log',cout:8}],[{craft:'#logs'}],[{go:{x:1.5,y:64,z:0}}],[{go:{x:1,y:64,z:0},bridge:'yes'}],[{get:'#logs',count:0}]])assert.throws(()=>defineMission(bad));
  assert.throws(()=>validateScenario({...mission,steps:[{...mission.steps[2],position:{x:0,z:0}}]}),/координаты/);
});

test('segmented A* reaches an observed frontier without inventing unloaded support',()=>{
  const getBlock=p=>p.x>8?null:p.y===100?stone:air;
  const options={start:{x:0,y:101,z:0},goal:{x:100,y:101,z:0},getBlock,maxDistance:12,maxNodes:512};
  assert.equal(planRoute(options).status,'blocked');
  const segment=planRoute({...options,allowPartial:true});
  assert.equal(segment.status,'planned');assert.equal(segment.partial,true);assert.ok(segment.target.x>=2&&segment.target.x<=8);
  assert.ok(segment.steps.every(s=>s.position.x<=8));assert.ok(segment.unknown.length);
  assert.equal(planRoute({...options,goal:{x:2,y:101,z:0},allowPartial:true}).partial,false);
});

test('navigation prepares interchangeable bridge material through the core resource planner',async()=>{
  const terrain=p=>p.z!==0?stone:p.y===100&&(p.x<=0||p.x>=3)?stone:air;
  const items=[{name:'oak_planks',count:1}],f=fixture(terrain,items), requests=[], results=[];
  const controller=createNavigationGoal({...f,position:{x:3,y:101,z:0},range:0,resourceFactory:targets=>{
    requests.push(targets);return {react:()=>({action:{skill:'gather',args:{block:'minecraft:stone'}},reason:'Stone prerequisite.'}),recordResult:(e,a)=>results.push([e,a])};
  }});
  assert.equal(controller.react(f.observation()).action,null);await planned(controller);
  const prerequisite=controller.react(f.observation());assert.equal(prerequisite.action.skill,'gather');assert.deepEqual(requests,[{'#stone':1}]);
  controller.recordResult({outcome:'success'},prerequisite.action);assert.equal(results.length,1);
  items.push({name:'cobblestone',count:1});controller.react(f.observation());await planned(controller);
  const move=controller.react(f.observation());assert.equal(move.action.skill,'navigate');assert.equal(move.action.args.bridge,true);
  controller.recordResult({outcome:'success'},move.action);
  assert.notEqual(controller.react(f.observation()),null,'a successful executor report cannot complete a coordinate goal');
  f.client.state.position={x:3.5,y:101,z:.5};assert.equal(controller.react(f.observation()),null);
  await planned(controller);
});

test('failed waypoint is temporarily avoided and resources/position changes invalidate plans',async()=>{
  const f=fixture(p=>p.y===100?stone:air),seen=[],planner=async options=>{
    seen.push(options.occupied({x:4,y:101,z:0}));
    return {status:'planned',target:{x:seen.length===1?4:3,y:101,z:0},steps:[],visited:1,unknown:[],bridgeUsed:0,partial:true};
  };
  const controller=createNavigationGoal({...f,position:{x:10,y:101,z:0},planner});
  controller.react(f.observation());await planned(controller);const action=controller.react(f.observation()).action;
  controller.recordResult({outcome:'failure'},action);controller.react(f.observation());await planned(controller);
  assert.deepEqual(seen,[false,true]);assert.equal(controller.react(f.observation()).action.args.x,3);
  assert.equal(controller.snapshot().avoided,1);
  f.client.state.dimension='minecraft:the_nether';assert.match(controller.react(f.observation()).reason,/Измерение/);
});

test('a plan calculated at an old position is discarded and a scenario records observed arrival',async()=>{
  const f=fixture(p=>p.y===100?stone:air);let release,calls=0;
  const planner=options=>{calls++;return new Promise(resolve=>{release=()=>resolve({status:'planned',target:{x:4,y:101,z:0},steps:[],visited:1,unknown:[],bridgeUsed:0});});};
  const controller=createNavigationGoal({...f,position:{x:4,y:101,z:0},range:0,planner});
  controller.react(f.observation());await tick();f.client.state.position.x=2.5;release();await planned(controller);
  assert.equal(controller.react(f.observation()).action,null);await tick();assert.equal(calls,2);release();await planned(controller);
  const scenario=createScenario({scenario:defineMission([{go:{x:4,y:101,z:0},range:0}]),catalog:f.catalog,navigationFactory:()=>controller});
  assert.equal(scenario.reactor.react(f.observation()).action.skill,'navigate');assert.equal(scenario.snapshot().status,'running');
  f.client.state.position.x=4.5;scenario.reactor.react(f.observation());assert.equal(scenario.snapshot().status,'completed');
});
