import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOMConnect} from '../omconnect/index.js';
import {readSlot} from '../packages/omconnect/src/inventory.js';
import {createNavigationRecoveryReactor} from '../src/navigation-recovery.js';

function fixture(){
  const client=createOMConnect();
  Object.assign(client.state,{dimension:'minecraft:overworld',position:{x:.5,y:64,z:.5},health:20,status:'ready',entityId:1});
  const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const cells=new Map(),key=p=>`${p.x},${p.y},${p.z}`;
  for(const x of [0,1])for(let y=64;y<=67;y++)cells.set(`${x},${y},0`,air);
  cells.set('2,66,0',air);cells.set('2,67,0',air);
  client.world.blockAt=p=>cells.has(key(p))?cells.get(key(p)):stone;
  client.inventory.slots[36]=readSlot({itemId:client.registry.itemsByName.dirt.id,itemCount:8,components:[],removeComponents:[]},client.registry,36);
  const core=new EventEmitter(),reactor=createNavigationRecoveryReactor({client});reactor.attach(core);
  const failure=()=>core.emit('action:finish',{rule:'overmind:scenario',skill:'navigate',outcome:'failure',failure:{code:'NO_PATH'}});
  const observe=()=>({dimension:client.state.dimension,self:{position:client.state.position,health:client.state.health}});
  return {client,core,reactor,failure,observe,cells};
}

test('repeated blocked routes restore a short mined-out stair with navigation then one pillar',()=>{
  const f=fixture();f.failure();f.failure();assert.equal(f.reactor.react(f.observe()).action,null);
  f.failure();const approach=f.reactor.react(f.observe()).action;
  assert.equal(approach.skill,'navigate');assert.deepEqual({x:approach.args.x,y:approach.args.y,z:approach.args.z},{x:1,y:64,z:0});
  f.client.state.position.x=1.5;
  const build=f.reactor.react(f.observe()).action;
  assert.deepEqual(build,{skill:'pillar',args:{count:1}});
  f.reactor.recordResult({outcome:'success'},build);
  assert.equal(f.reactor.react(f.observe()).action,null);
});

test('recovery rejects unknown jump space, protected placement and low health',()=>{
  for(const kind of ['unknown','protected','health','valuable-only']){
    const f=fixture();
    if(kind==='unknown')f.cells.set('1,67,0',null);
    if(kind==='protected')f.client.protection.add({id:'owner',dimension:'minecraft:overworld',min:{x:1,y:64,z:0},max:{x:1,y:64,z:0}});
    if(kind==='health')f.client.state.health=6;
    if(kind==='valuable-only')f.client.inventory.slots[36]=readSlot({itemId:f.client.registry.itemsByName.diamond_block.id,itemCount:8,components:[],removeComponents:[]},f.client.registry,36);
    f.failure();f.failure();f.failure();assert.equal(f.reactor.react(f.observe()).action,null,kind);
  }
});

test('an exhausted search budget may use only the same independently verified local recovery',()=>{
  const f=fixture();for(let i=0;i<3;i++)f.core.emit('action:finish',{rule:'overmind:scenario',skill:'navigate',outcome:'failure',failure:{code:'SEARCH_BUDGET'}});
  assert.equal(f.reactor.react(f.observe()).action.skill,'navigate');
  f.cells.set('1,67,0',null);assert.equal(f.reactor.react(f.observe()).action,null);
});
