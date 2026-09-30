import test from 'node:test';
import assert from 'node:assert/strict';
import {teamSupplyTargets,shareTeamSupplies,diamondSetTargets} from '../mckudo_core.js';
const client=(username,inventory,equipped={})=>({options:{username},state:{status:'ready',health:20,food:20,dimension:'minecraft:overworld',position:{x:0,y:64,z:0}},inventory:{snapshot:()=>({...inventory}),equipment:()=>equipped,count:n=>inventory[n.startsWith('minecraft:')?n:'minecraft:'+n]||0,ownedCount:n=>(inventory[n.startsWith('minecraft:')?n:'minecraft:'+n]||0)+Object.values(equipped).filter(i=>i.item==='minecraft:'+n.replace(/^minecraft:/,'')).length},items:inventory});
test('one chest taker shares surplus armor, tools and beds while keeping their own set',async()=>{
  const gear=['iron_helmet','iron_chestplate','iron_leggings','iron_boots','iron_sword','iron_axe','white_bed'];
  const a=client('Owen',Object.fromEntries(gear.map(n=>['minecraft:'+n,3]))),b=client('Liam',{}),c=client('Noah',{});
  const report=await shareTeamSupplies({clients:[a,b,c],maxTransfers:24,deliver:async({from,to,item,count})=>{from.items[item]-=count;to.items[item]=(to.items[item]||0)+count;return {status:'completed'};}});
  assert.equal(report.status,'completed');assert.equal(report.transfers.length,14);
  for(const member of [a,b,c])for(const item of gear)assert.equal(member.items['minecraft:'+item],1);
});
test('sharing keeps worn armor and diamond materials for the remaining goal, and stops on partial receipt',async()=>{
  const a=client('Owen',{'minecraft:diamond':32,'minecraft:iron_helmet':2},{head:{item:'minecraft:iron_helmet',name:'iron_helmet',count:1}}),b=client('Liam',{});
  const t=teamSupplyTargets(a,[a,b],diamondSetTargets());assert.equal(t['minecraft:diamond'],32);
  let calls=0;const report=await shareTeamSupplies({clients:[a,b],targets:()=>diamondSetTargets(),deliver:async()=>{calls++;return {status:'partial',reason:'Pickup not confirmed.'};}});
  assert.equal(report.status,'partial');assert.equal(calls,1);assert.equal(a.inventory.equipment().head.item,'minecraft:iron_helmet');
});
