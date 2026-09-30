import test from 'node:test';
import assert from 'node:assert/strict';
import {runTrade} from '../src/trade.js';
const client=inventory=>({inventory:{snapshot:()=>({...inventory})},state:{food:20}});
test('beneficial exchange delivers both legs and records partial failure without retry',async()=>{
  const from=client({'minecraft:diamond':4}),to=client({'minecraft:iron_ingot':10});
  let calls=0;const result=await runTrade({from,to,fromTargets:{iron_ingot:1},toTargets:{diamond:1},allowGift:false,deliver:async()=>({status:++calls===1?'completed':'failed',reason:'Receiver disconnected.'})});
  assert.equal(result.plan.kind,'trade');assert.ok(result.plan.fromGain>0&&result.plan.toGain>0);
  assert.equal(result.status,'partial');assert.equal(calls,2);assert.equal(result.deliveries.length,2);
});
test('gift keeps reserve and only sends a recipient deficit',async()=>{
  const from=client({'minecraft:apple':10}),to=client({});let transfer;
  const result=await runTrade({from,to,toTargets:{apple:3},deliver:async offer=>{transfer=offer;return {status:'completed'};}});
  assert.equal(result.status,'completed');assert.equal(result.plan.kind,'gift');assert.equal(transfer.count,2);
  assert.equal((await runTrade({from:client({apple:8}),to,toTargets:{apple:3}})).status,'unnecessary');
});
