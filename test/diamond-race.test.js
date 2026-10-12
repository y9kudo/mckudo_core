import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceDigest,diamondEvidence,rankRace,sharingCandidate,cleanInventory,raceContinuation} from '../examples/benchmark/race-metrics.js';

test('diamond race rejects gifts, remote pickups and pre-start observations',()=>{
 const observation={startedAt:1000,now:4000,inventory:{'minecraft:diamond':1},mined:[{at:3000,block:'deepslate_diamond_ore',position:{x:0,y:-50,z:0}}]};
 assert.equal(diamondEvidence(observation),null);
 const pickup={at:3500,item:'diamond',own:true,position:{x:1,y:-50,z:0}};
 assert.equal(diamondEvidence({...observation,mined:[],pickups:[pickup]}),null);
 assert.equal(diamondEvidence({...observation,pickups:[{...pickup,own:false}]}),null);
 assert.equal(diamondEvidence({...observation,pickups:[{...pickup,position:{x:100,y:20,z:0}}]}),null);
 assert.equal(diamondEvidence({...observation,startedAt:5000,pickups:[pickup]}),null);
 const evidence=diamondEvidence({...observation,pickups:[pickup]});
 assert.equal(evidence.elapsedMs,3000);assert.equal(evidence.kind,'own-ore-and-observed-pickup');
 assert.equal(diamondEvidence({...observation,now:30000,pickups:[pickup]}),null);
 assert.deepEqual(cleanInventory({'minecraft:stone':2,'minecraft:air':0}),{stone:2});
});
test('race ranking requires evidence and orders by observed finish, not version',()=>{
 assert.deepEqual(rankRace({newer:{name:'B',version:'0.7',diamondEvidence:{at:5000,elapsedMs:4000}},gift:{name:'C',version:'0.6'},older:{name:'A',version:'0.5',diamondEvidence:{at:4000,elapsedMs:3000}}}).map(a=>a.name),['A','B']);
});
test('cooperation retains reserves and never transfers diamonds or dead agents resources',()=>{
 const make=(name,version,inventory)=>({name,version,status:'running',sampledAt:1000,state:{position:{x:0,y:64,z:0},inventory,health:20}});
 const from=make('Atlas','0.2.0',{oak_log:8,diamond:64}),to=make('Flynn','0.7.0-dev.0',{});
 const offer=sharingCandidate({from,to},2000);assert.equal(offer.item,'oak_log');assert.equal(offer.count,4);
 assert.equal(sharingCandidate({from:make('Atlas','0.2.0',{oak_log:2,diamond:64}),to},2000),null);
 assert.equal(sharingCandidate({from,to},2000,new Map([['Atlas',3000]])),null);
 assert.equal(sharingCandidate({from:{...from,status:'dead'},to},2000),null);
 assert.equal(sharingCandidate({from,to},20000),null);
 assert.equal(sharingCandidate({from,to:{...to,state:{...to.state,position:{x:100,y:64,z:0}}}},2000),null);
});
test('source fingerprint detects modified historical code',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mckudo-race-hash-'));
 try{fs.writeFileSync(path.join(root,'index.js'),'export const v=1;');const hash=sourceDigest(root);assert.equal(sourceDigest(root),hash);fs.writeFileSync(path.join(root,'index.js'),'export const v=2;');assert.notEqual(sourceDigest(root),hash);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('logistics does not circulate sole workstations and shares obsolete picks while retaining the best',()=>{
 const make=(name,version,inventory)=>({name,version,status:'running',sampledAt:1000,state:{position:{x:0,y:64,z:0},inventory,health:20}});
 const from=make('A','0.3.0',{crafting_table:1}),to=make('B','0.2.0',{});
 assert.equal(sharingCandidate({from,to},2000),null);
 from.state.inventory.crafting_table=2;assert.equal(sharingCandidate({from,to},2000),null,'0.2 cannot craft or place the table');
 const donor=make('C','0.7.0-dev.0',{iron_pickaxe:1,stone_pickaxe:1}),receiver=make('D','0.5.0',{wooden_pickaxe:1});
 const offer=sharingCandidate({donor,receiver},2000);assert.equal(offer.item,'stone_pickaxe');assert.equal(offer.count,1);
 assert.equal(sharingCandidate({donor,receiver:make('E','0.2.0',{})},2000),null,'old gathering rules need an iron-tier tool for diamonds');
});

test('continuation preserves contenders and cumulative milestones but rejects changed or dead sources',()=>{
 const releases=[{id:'v07',version:'0.7.0-dev.0',name:'Flynn07',sourceSHA256:'original'}];
 const server={host:'127.0.0.1',port:25565},settings={...server,dependencyLockSHA256:'lock'};
 const agent={...releases[0],name:'Flynn07test',processClosed:true,state:{health:20},milestones:{iron_pickaxe:700000},actions:{'dig/success':88}};
 const report={status:'incomplete',fromEmptyInventory:true,server,dependencyLockSHA256:'lock',startedAt:1000,finishedAtMs:901000,agents:{Flynn07test:agent}};
 const next=raceContinuation(report,releases,settings);assert.equal(next.elapsedMs,900000);assert.equal(next.releases[0].name,'Flynn07test');assert.equal(next.releases[0].resume.milestones.iron_pickaxe,700000);
 assert.throws(()=>raceContinuation(report,[{...releases[0],sourceSHA256:'modified'}],settings),/changed/);
 assert.throws(()=>raceContinuation({...report,agents:{A:{...agent,state:{health:0}}}},releases,settings),/dead/);
 assert.throws(()=>raceContinuation(report,releases,{...settings,port:25566}),/same server/);
 assert.throws(()=>raceContinuation({...report,status:'running'},releases,settings),/incomplete/);
 assert.equal(raceContinuation({...report,activeElapsedMs:1800000},releases,settings).elapsedMs,1800000);
});
