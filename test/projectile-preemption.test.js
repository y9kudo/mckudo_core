import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createCombatReactor} from '../src/combat.js';
import {createCore} from '../src/core.js';

const arrow={id:'42',name:'arrow',kind:'entity',position:{x:0,y:2,z:10},velocity:{x:0,y:0,z:-2},ownerId:2,visible:true};
const observation=()=>({dimension:'world',self:{entityId:1,position:{x:0,y:1,z:0},health:20,shield:true},inventory:{},entities:[arrow]});
test('projectile defense does not require retaliation or attackPlayers and does not attack the shooter',()=>{
  const reactor=createCombatReactor({attackPlayers:false}),o=observation(),response=reactor.react(o);
  assert.equal(response.action.skill,'guard');assert.equal(response.action.args.reactive,true);assert.ok(response.priority>990);
  o.self.shield=false;assert.equal(reactor.react(o).action,null);
  o.self.shield=true;o.self.shieldDisabled=true;assert.equal(reactor.react(o).action,null);
});
test('an incoming arrow interrupts an ongoing bow action promptly even with a long normal polling interval',async()=>{
  let wake,threat=false,started,guarded,cancelled=false;
  const began=new Promise(r=>started=r),defended=new Promise(r=>guarded=r);
  const observe=()=>({...observation(),entities:threat?[arrow]:[]});
  const core=createCore({config:{schemaVersion:4,name:'Defense',worldId:'arrow-defense',tickIntervalMs:2000,rules:[{id:'draw',action:{skill:'shoot',args:{}}}]},preemptionMs:2000,reactors:[createCombatReactor()],
    adapter:{describe:()=>({protocolVersion:1,skills:['shoot','guard']}),observe:async()=>observe(),observeThreats:async()=>observe(),subscribeUrgent:cb=>{wake=cb;return()=>{};},execute:async(action,{signal})=>{
      if(action.skill==='guard'){guarded();await delay(50,undefined,{signal});return {ok:true};}
      started();await new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled=true;resolve();},{once:true}));return {ok:true};
    }}});
  try{core.start();await began;threat=true;const at=performance.now();wake();await Promise.race([defended,delay(500).then(()=>{throw new Error('Guard waited for the normal polling interval.');})]);assert.equal(cancelled,true);assert.ok(performance.now()-at<300);}
  finally{await core.stop();}
});
