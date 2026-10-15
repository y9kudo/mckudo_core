import test from 'node:test';
import assert from 'node:assert/strict';
import {planResourcePillar,constructionSoil} from '../src/elevated-access.js';
import {createSurvivalReactor} from '../src/survival-brain.js';
import {catalogFromMinecraftData} from '../src/catalog.js';
import {OMConnect} from '../packages/omconnect/index.js';

const key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const air={name:'air',boundingBox:'empty',shapes:[]},dirt={name:'dirt',diggable:true,hardness:.5,boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
const target={x:0,y:21,z:0};
const flat=p=>p.y<1?dirt:key(p)===key(target)?{...dirt,name:'diamond_ore'}:air;
test('floating resources receive a side column and a reserved catch block, with bounded known clearance',()=>{
  const options={position:{x:1.5,y:1,z:.5},target,getBlock:flat};
  const plan=planResourcePillar(options);assert.equal(plan.status,'planned');assert.equal(plan.base.x,1);assert.equal(plan.base.y,1);assert.equal(plan.base.z,0);
  assert.equal(plan.blocksNeeded,21);assert.equal(plan.stagingY,19);assert.deepEqual(plan.catchBlock,{x:0,y:20,z:0});
  assert.equal(planResourcePillar({...options,maxRise:10}).status,'blocked');
  assert.equal(planResourcePillar({...options,getBlock:p=>p.y>4?null:flat(p)}).status,'blocked');
  assert.equal(planResourcePillar({...options,canPlace:()=>false}).status,'blocked');
});
test('an existing partial column is reused only when its full cubes belong to this client',()=>{
  const first=planResourcePillar({position:{x:1.5,y:1,z:.5},target,getBlock:flat});
  const world=p=>p.x===1&&p.z===0&&p.y>=1&&p.y<9?dirt:flat(p);
  const options={position:{x:1.5,y:9,z:.5},target,getBlock:world,previous:first};
  assert.equal(planResourcePillar(options).status,'blocked');
  const next=planResourcePillar({...options,owned:()=>true});assert.equal(next.top.y,9);assert.equal(next.blocksNeeded,13);
});
test('construction soil stays at the staging ground level after a one-block pickup descent',()=>{
  const soil=constructionSoil({position:{x:3.5,y:0,z:.5},base:{x:1,y:1,z:0},getBlock:flat});
  assert.equal(soil.y,0);assert.ok(Math.max(Math.abs(soil.x-1),Math.abs(soil.z))>=2);
});
function fixture(dirtCount){
  const c=new OMConnect(),cells=new Map();
  const block=n=>({...c.registry.blocksByName[n],name:n,shapes:n==='air'?[]:[[0,0,0,1,1,1]]});
  c.world.blockAt=p=>cells.get(key(p))??block(p.y<1?'dirt':key(p)===key(target)?'diamond_ore':'air');
  Object.assign(c.state,{position:{x:1.5,y:1,z:.5},health:20,food:20,status:'ready',onGround:true,entityId:1,dimension:'minecraft:overworld'});
  for(const [slot,name,count]of [[36,'iron_pickaxe',1],[37,'dirt',dirtCount]])if(count)c.inventory.slots[slot]={slot,name,item:'minecraft:'+name,type:c.registry.itemsByName[name].id,count,raw:{components:[]}};
  const reactor=createSurvivalReactor({client:c,catalog:catalogFromMinecraftData(c.registry),targets:{diamond:1},exploration:false});
  const observation=()=>({dimension:c.state.dimension,self:{...c.state},inventory:c.inventory.snapshot(),world:{sampledBlocks:[{name:'minecraft:diamond_ore',position:target}]},entities:[],drops:[]});
  c.pillarBlocks=new Map();
  const build=(from,to)=>{for(let y=from;y<to;y++){const p={x:1,y,z:0};cells.set(key(p),block('dirt'));c.pillarBlocks.set(`minecraft:overworld/1,${y},0`,{name:'dirt',baseY:1});}c.inventory.slots[37].count-=to-from;c.state.position.y=to;};
  return {c,cells,block,reactor,observation,build};
}
test('a diamond inventory goal plans pillar batches, an underside catch platform, final ascent and mining',()=>{
  const f=fixture(21),{c,reactor:r,observation:o}=f;
  const first=r.react(o());assert.ok(first.action,first.reason);assert.equal(first.action.skill,'pillar');assert.equal(first.action.args.count,8);
  f.build(1,19);const catchStep=r.react(o()).action;assert.equal(catchStep.skill,'place');assert.deepEqual([catchStep.args.x,catchStep.args.y,catchStep.args.z],[0,20,0]);
  f.cells.set('0,20,0',f.block('dirt'));c.inventory.slots[37].count--;
  const final=r.react(o()).action;assert.equal(final.skill,'pillar');assert.equal(final.args.count,2);
  f.build(19,21);const mine=r.react(o()).action;assert.equal(mine.skill,'dig');assert.equal(mine.args.block,'minecraft:diamond_ore');assert.equal(mine.args.y,21);
  assert.notEqual(r.snapshot().status,'completed');const received=o();received.inventory['minecraft:diamond']=1;assert.equal(r.react(received).action,null);assert.equal(r.snapshot().status,'completed');
});
test('insufficient construction stock causes safe soil procurement before the first ascent',()=>{
  const f=fixture(0),step=f.reactor.react(f.observation());assert.ok(step.action,step.reason);assert.equal(step.action.skill,'dig');assert.equal(step.action.args.block,'minecraft:dirt');assert.equal(step.action.args.y,0);assert.match(step.reason,/construction blocks/);
});
