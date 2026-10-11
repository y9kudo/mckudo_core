import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../src/core.js';
import {createCombatReactor} from '../src/combat.js';

test('one unreachable combat target does not suppress defense against another attacker',async()=>{
  let id='1';const calls=[];
  const core=createCore({config:{schemaVersion:4,worldId:'pvp-recovery',name:'Alice',rules:[]},clock:()=>1000,
    reactors:[createCombatReactor()],adapter:{describe:()=>({protocolVersion:1,perceptionVersion:1,skills:['combat']}),
      observe:async()=>({dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20,food:20},entities:[{id,name:'zombie',kind:'mob',hostile:true,visible:true,position:{x:4,y:64,z:0}}],inventory:{}}),
      execute:async action=>{calls.push(action.args.entityId);if(action.args.entityId==='1')throw new Error('No reachable route');return {ok:true};}}
  });
  try{
    await core.tick();assert.equal(core.snapshot().lastResult.outcome,'failure');
    await core.tick();assert.deepEqual(calls,['1'],'same failed target backs off');
    id='2';await core.tick();assert.deepEqual(calls,['1','2']);assert.equal(core.snapshot().lastResult.outcome,'success');
  }finally{await core.stop();}
});

test('combat remembers a blocked nearest target, defends against another, and reconsiders a moved threat',()=>{
  let now=1000;const r=createCombatReactor({clock:()=>now});
  const mob=(id,x)=>({id,name:'zombie',kind:'mob',hostile:true,visible:true,position:{x,y:64,z:0}});
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20},entities:[mob('1',2),mob('2',4)]};
  const first=r.react(o);assert.equal(first.action.args.entityId,'1');r.recordResult({outcome:'failure'},first.action);
  assert.equal(r.react(o).action.args.entityId,'2');
  o.entities[0].position.z=2;assert.equal(r.react(o).action.args.entityId,'1');
  r.recordResult({outcome:'failure'},r.react(o).action);now+=5001;assert.equal(r.react(o).action.args.entityId,'1');
});

test('fresh attributed hits and low health retain defense despite a previous route failure',()=>{
  let now=1000;const r=createCombatReactor({attackPlayers:true,clock:()=>now});
  const o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20},entities:[{id:'1',name:'player',kind:'player',username:'Enemy',position:{x:3,y:64,z:0}}],combat:{attackers:[{entityId:'1',hits:2,lastHitAt:999}]}};
  const first=r.react(o);r.recordResult({outcome:'failure'},first.action);assert.equal(r.react(o).action,null);
  now=1001;o.combat.attackers[0].lastHitAt=1001;assert.equal(r.react(o).action.args.entityId,'1');
  r.recordResult({outcome:'failure'},r.react(o).action);o.self.health=6;assert.equal(r.react(o).action.args.entityId,'1');
});
