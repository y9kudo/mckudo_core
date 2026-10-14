import test from 'node:test';
import assert from 'node:assert/strict';
import {createDragonPolicy,dragonExpeditionScenario,validateScenario} from '../overmindmc.js';
import {createOMConnect,perchedDragonHead} from '../omconnect/index.js';
const air={name:'air',shapes:[],boundingBox:'empty'},stone={name:'end_stone',shapes:[[0,0,0,1,1,1]],boundingBox:'block'};
function setup(){const c=createOMConnect();c.state.position={x:.5,y:64,z:.5};c.world.blockAt=p=>p.y<64?stone:air;c.inventory.items=()=>[];const policy=createDragonPolicy({client:c});const o={dimension:'minecraft:the_end',self:{position:c.state.position,health:20},inventory:{'minecraft:bow':1,'minecraft:arrow':64},entities:[]};return {c,policy,o};}
test('full objective contains supplies before entering the Nether and an explicit dragon goal',()=>{
  const s=validateScenario(dragonExpeditionScenario());assert.equal(s.steps.at(-1).type,'dragon');assert.ok(s.steps.findIndex(s=>s.id==='dragon-supplies')<s.steps.findIndex(s=>s.id==='enter-nether'));
});
test('native policy shoots an unobstructed high crystal and retreats from nearby explosions',()=>{
  const {policy,o}=setup();o.entities=[{id:'1',name:'end_crystal',position:{x:30,y:84,z:0},velocity:{x:0,y:0,z:0}}];
  assert.equal(policy.react(o).action.skill,'shoot');o.entities[0].position={x:4,y:64,z:0};assert.equal(policy.react(o).action.skill,'evade');
});
test('dragon absence, landing and death are distinct observations',()=>{
  const {policy,o}=setup();assert.equal(policy.react(o).action,null);
  o.entities=[{id:'4',name:'ender_dragon',position:{x:20,y:65,z:0},velocity:{x:0,y:0,z:0},yaw:90,pitch:0,phase:5}];assert.equal(policy.react(o).action.skill,'navigate');
  o.endgame={dragonDeath:{confirmed:true}};assert.equal(policy.react(o),null);
});
test('perched dragon head gets a ground approach and a dedicated melee action',()=>{
  const {c,policy,o}=setup(),dragon={id:'4',name:'ender_dragon',position:{x:20,y:65,z:0},velocity:{x:0,y:0,z:0},yaw:90,pitch:0,phase:5};
  o.entities=[dragon];
  const head=perchedDragonHead(dragon);assert.equal(head.x,26.5);assert.equal(head.y,64);assert.ok(Math.abs(head.z)<1e-12);
  const first=policy.react(o);
  assert.equal(first.action.skill,'navigate');
  c.state.position={x:first.action.args.x+.5,y:first.action.args.y,z:first.action.args.z+.5};o.self.position=c.state.position;
  const second=policy.react(o);
  assert.equal(second.action.skill,'attackDragon');assert.equal(second.action.args.critical,true);
});
test('closed cage plans a reversible tower only with material, headroom and reachable support',()=>{
  const {c,policy,o}=setup();const crystal={id:'7',name:'end_crystal',position:{x:20.5,y:80,z:.5},velocity:{x:0,y:0,z:0}};o.entities=[crystal];
  c.world.blockAt=p=>{
    const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);
    if(x>=18&&x<=22&&z>=-2&&z<=2&&y>=80&&y<=83)return {...stone,name:'iron_bars'};
    if(x>=18&&x<=22&&z>=-2&&z<=2&&y>=64&&y<80)return {...stone,name:'obsidian'};
    return y<64?stone:air;
  };
  c.inventory.items=()=>[{name:'cobblestone',count:64,slot:36}];
  const result=policy.react(o);assert.equal(result.action.skill,'navigate');assert.ok(policy.snapshot().tower);
  c.state.position={x:result.action.args.x+.5,y:64,z:result.action.args.z+.5};o.self.position=c.state.position;
  assert.equal(policy.react(o).action.skill,'pillar');
  policy.recordResult({outcome:'failure'},{skill:'pillar'});policy.recordResult({outcome:'failure'},{skill:'pillar'});
  c.pillarBlocks=new Map([[`${o.dimension}/${Math.floor(c.state.position.x)},63,${Math.floor(c.state.position.z)}`,{}]]);
  assert.equal(policy.react(o).action.skill,'descendPillar');
});
