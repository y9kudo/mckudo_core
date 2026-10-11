import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignJournal} from '../mckudo_core.js';
const initial={scenario:{status:'running',current:'wood',completed:[],reason:'Добыть дерево'},self:{health:20,dimension:'minecraft:overworld'},inventory:{}};
test('campaign journal detects a stuck stage; position changes alone are not progression',()=>{
  let now=0;const journal=createCampaignJournal({clock:()=>now,stallAfterMs:1000});journal.observe(initial);now=2000;
  const stalled=journal.observe({...initial,self:{...initial.self,position:{x:100,y:64,z:100}}});assert.equal(stalled.status,'stalled');assert.equal(stalled.goalConfirmed,false);
  assert.equal(journal.observe({...initial,inventory:{'minecraft:birch_log':1}}).status,'running');
});
test('dragon campaign cannot claim victory without observed own damage',()=>{
  const journal=createCampaignJournal({objective:'defeat-dragon'}),done={...initial,scenario:{status:'completed',current:null,completed:['dragon']},self:{health:20,dimension:'minecraft:the_end'}};
  assert.equal(journal.observe(done).status,'unverified');assert.equal(journal.observe({...done,endgame:{dragonDeath:{confirmed:true,ownDamageConfirmed:false}}}).goalConfirmed,false);
  assert.equal(journal.observe({...done,endgame:{dragonDeath:{confirmed:true,ownDamageConfirmed:true}}}).status,'completed');
});
test('journal retains bounded independent snapshots and distinguishes death',()=>{
  const journal=createCampaignJournal({maxEntries:2});for(let i=1;i<=3;i++)journal.observe({...initial,inventory:{'minecraft:birch_log':i}});
  const snapshot=journal.snapshot();assert.equal(snapshot.entries.length,2);snapshot.entries.length=0;assert.equal(journal.snapshot().entries.length,2);
  assert.equal(journal.observe({...initial,self:{...initial.self,health:0}}).status,'dead');
});
