import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,createCatalog} from '../overmindmc.js';
import {recordHomeTrail,homeReturnWaypoint,hasOpenSky} from '../src/home-route.js';
const catalog=createCatalog({version:'test',items:[],blocks:[],recipes:[]}),definition={schemaVersion:1,name:'Shelter',steps:[{id:'shelter',type:'shelter'}]};
test('shelter preparation returns from a deep mine to its observed origin and forwards navigation results',()=>{
  let requested,recorded;const anchor={x:3,y:70,z:4};
  const c=createScenario({scenario:definition,catalog,getBlock:()=>null,memory:{schemaVersion:1,definition,completed:[],portals:[],homeAnchor:anchor},navigationFactory:step=>{requested=step;return {react:()=>({action:{skill:'navigate',args:step.position},reason:'Planning return.'}),recordResult:r=>{recorded=r;}};}});
  const decision=c.reactor.react({dimension:'minecraft:overworld',self:{position:{x:10,y:30,z:4}},inventory:{}});
  assert.equal(decision.action.skill,'navigate');assert.deepEqual(requested.position,anchor);assert.equal(requested.excavate,true);assert.equal(requested.bridge,false);
  c.recordResult({outcome:'success'},decision.action);assert.equal(recorded.outcome,'success');assert.deepEqual(c.exportMemory().homeAnchor,anchor);
  assert.throws(()=>createScenario({scenario:definition,catalog,memory:{schemaVersion:1,definition,completed:[],portals:[],homeAnchor:{x:0,y:NaN,z:0}}}),/anchor/);
});
test('a fresh scenario records its first Overworld observation as the persistent home anchor',()=>{
  const c=createScenario({scenario:{schemaVersion:1,name:'Wait',steps:[{id:'collect',type:'collect',item:'minecraft:stone',count:1}]},catalog});
  c.reactor.react({dimension:'minecraft:overworld',self:{position:{x:2.8,y:65,z:-.1}},inventory:{},drops:[]});
  assert.deepEqual(c.exportMemory().homeAnchor,{x:2,y:65,z:-1});
});
test('home corridors erase loops, rejoin after a displacement and reverse through short known segments',()=>{
  const trail=[];for(let i=0;i<8;i++)recordHomeTrail(trail,{x:i,y:70-i,z:0});
  assert.deepEqual(homeReturnWaypoint(trail,{x:7,y:63,z:0},{}),{x:4,y:66,z:0});
  assert.deepEqual(homeReturnWaypoint(trail,{x:30,y:63,z:0},{}),{x:7,y:63,z:0});
  recordHomeTrail(trail,{x:2,y:68,z:0});assert.equal(trail.length,3);
  const c=createScenario({scenario:definition,catalog,getBlock:()=>null,memory:{schemaVersion:1,definition,completed:[],portals:[],homeAnchor:{x:0,y:70,z:0},homeTrail:trail},navigationFactory:step=>({react:()=>({action:{skill:'navigate',args:{...step.position,excavate:step.excavate}}})})});
  assert.equal(c.reactor.react({dimension:'minecraft:overworld',self:{position:{x:2,y:60,z:0}},inventory:{}}).action.args.excavate,false);
});
test('an obstructed return segment tries walking first, then requests protected route excavation',()=>{
  const modes=[];
  const c=createScenario({scenario:definition,catalog,getBlock:()=>null,memory:{schemaVersion:1,definition,completed:[],portals:[],homeAnchor:{x:0,y:70,z:0},homeTrail:[{x:0,y:70,z:0},{x:3,y:65,z:0}]},navigationFactory:step=>{modes.push(step.excavate);return {snapshot:()=>({status:step.excavate?'ready':'blocked'}),react:()=>({action:{skill:'navigate',args:{...step.position,excavate:step.excavate}}})};}});
  const decision=c.reactor.react({dimension:'minecraft:overworld',self:{position:{x:3,y:60,z:0}},inventory:{}});
  assert.deepEqual(modes,[false,true]);assert.equal(decision.action.args.excavate,true);
});
test('known open sky accepts natural canopy but rejects roofs and unloaded cells',()=>{
  const position={x:1,y:30,z:2};
  assert.equal(hasOpenSky({position,maxY:40,getBlock:p=>({name:p.y===33?'spruce_leaves':'air'})}),true);
  assert.equal(hasOpenSky({position,maxY:40,getBlock:p=>p.y===33?null:{name:'air'}}),false);
  assert.equal(hasOpenSky({position,maxY:40,getBlock:p=>({name:p.y===33?'stone':'air'})}),false);
});
