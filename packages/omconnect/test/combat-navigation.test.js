import test from 'node:test';
import assert from 'node:assert/strict';
import {OMConnect} from '../index.js';
import {CombatPursuit,combatApproach} from '../src/combat-navigation.js';
import {stepPhysics} from '../src/physics.js';

const air={name:'air',boundingBox:'empty',shapes:[]},stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
function fixture(getBlock){
  const c=new OMConnect();Object.assign(c.state,{position:{x:.5,y:1,z:.5},velocity:{x:0,y:-.0784,z:0},health:20,food:20,status:'ready',onGround:true,dimension:'minecraft:overworld'});
  c.world={blockAt:p=>getBlock({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)})};
  const target={id:'2',kind:'player',position:{x:5.5,y:1,z:.5}};c.entities.set(2,target);return {c,target};
}

test('pursuit detects circling, bounds travel and does not carry a failed target into a new encounter',()=>{
  const p=new CombatPursuit(),target={id:'2',position:{x:6,y:1,z:0}},position={x:0,y:1,z:0};
  assert.equal(p.observe({target,position,dimension:'world',now:0}).allowed,true);
  assert.equal(p.observe({target,position:{x:0,y:1,z:1},dimension:'world',now:1500}).allowed,true);
  assert.equal(p.observe({target,position,dimension:'world',now:3100}).allowed,false);
  const next={...target,id:'3'};assert.equal(p.observe({target:next,position,dimension:'world',now:3101}).allowed,true);
  assert.equal(p.observe({target:next,position:{x:30,y:1,z:0},dimension:'world',now:3102}).allowed,false);
});

test('combat detours around a wall and never includes excavation or bridge steps',async()=>{
  const f=fixture(p=>p.y<1||p.x===2&&Math.abs(p.z)<=1&&p.y<=4?stone:air),signal=AbortSignal.timeout(3000);
  const control=await combatApproach(f.c,f.target,signal);
  assert.ok(Math.abs(control.z)>0);assert.equal(control.jump,false);
  assert.ok(f.c.combatRoute.steps.length>0);assert.ok(f.c.combatRoute.steps.every(s=>['walk','jump','drop'].includes(s.kind)));
  assert.ok(f.c.combatRoute.steps.some(s=>Math.abs(s.position.z)>=2));
});

test('combat climbs a one-block ledge using ordinary physics and stops at unknown gaps',async()=>{
  const f=fixture(p=>p.y<1||p.x>=1&&p.y===1?stone:air);f.target.position.y=2;
  const signal=AbortSignal.timeout(4000);let jumped=false;
  for(let i=0;i<65&&f.c.state.position.x<2;i++){
    const control=await combatApproach(f.c,f.target,signal);jumped||=control.jump;
    f.c.state=stepPhysics(f.c.state,control,f.c.world.blockAt);
  }
  assert.equal(jumped,true);assert.ok(f.c.state.position.x>1.5);assert.ok(f.c.state.position.y>=2);
  const gap=fixture(p=>p.x===0?(p.y<1?stone:air):null);
  assert.deepEqual(await combatApproach(gap.c,gap.target,signal),{x:0,z:0,jump:false,sprint:false});
});

test('a cancelled pursuit never continues a cached route',async()=>{
  const f=fixture(p=>p.y<1||p.x===2&&Math.abs(p.z)<=1&&p.y<=4?stone:air),controller=new AbortController();
  await combatApproach(f.c,f.target,controller.signal);controller.abort(new Error('stop'));
  await assert.rejects(combatApproach(f.c,f.target,controller.signal),/stop/);
});
