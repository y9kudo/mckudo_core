import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installEndEvidence} from '../src/end-evidence.js';

function fixture(){const c=new EventEmitter();c.state={dimension:'minecraft:the_end',entityId:1};c.endgame={eyes:[]};c.entities=new Map();let now=1000;installEndEvidence(c,{clock:()=>now});return {c,advance:ms=>now+=ms};}
const crystal={id:'2',name:'end_crystal',position:{x:20,y:80,z:0}},dragon={id:'3',name:'ender_dragon',metadata:{health:200,phase:0}};
test('crystal evidence needs timely correlated explosion and removal, in either order',()=>{
  for(const reverse of [false,true]){const {c}=fixture();c.emit('entity',crystal);
    const events=[()=>c.emit('entityGone',crystal),()=>c.emit('explosion',{position:crystal.position})];if(reverse)events.reverse();
    events[0]();assert.equal(c.endgame.crystals.length,0);events[1]();assert.equal(c.endgame.crystals.length,1);
  }
  const {c,advance}=fixture();c.emit('entity',crystal);c.emit('entityGone',crystal);advance(3000);c.emit('explosion',{position:crystal.position});assert.equal(c.endgame.crystals.length,0);
});
test('dragon removal, other damage and stale phase do not prove own victory',()=>{
  const {c}=fixture();c.entities.set(3,dragon);c.emit('entityGone',dragon);assert.equal(c.endgame.dragonDeath,undefined);
  c.emit('entity',{...dragon,metadata:{health:0,phase:0}});assert.equal(c.endgame.dragonDeath,undefined);
  c.emit('damage',{entityId:'3',sourceId:'44'});c.emit('entityDead',dragon);assert.equal(c.endgame.dragonDeath.ownDamageConfirmed,false);
});
test('own server damage plus zero health and dying phase establishes dragon evidence',()=>{
  const {c}=fixture();c.entities.set(3,dragon);c.emit('damage',{entityId:'3',sourceId:'1'});
  c.emit('entity',{...dragon,metadata:{health:0,phase:9}});assert.equal(c.endgame.dragonDeath.confirmed,true);assert.equal(c.endgame.dragonDeath.ownHitCount,1);
});
