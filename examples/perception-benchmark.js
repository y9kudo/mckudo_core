import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {selectPerceivedEntities,createEntitySensor} from '../src/entity-perception.js';
import {createPerceptionTracker} from '../overmindmc.js';

const entities=Array.from({length:4096},(_,i)=>({id:String(i),name:i%31===0?'zombie':'item',kind:'entity',position:{x:1+i%64,y:64,z:(i*7)%32},velocity:{x:0,y:0,z:0},metadata:{}}));
const options={position:{x:0,y:64,z:0},dimension:'minecraft:overworld',limit:128,radius:192},times=[];
for(let i=0;i<5;i++)selectPerceivedEntities(entities,options);
let result;
for(let i=0;i<31;i++){const start=performance.now();result=selectPerceivedEntities(entities,options);times.push(performance.now()-start);}
assert.equal(result.entities.length,128);assert.ok(result.entities.every(e=>e.entity.name==='zombie'));
const tracker=createPerceptionTracker(),client={state:{position:options.position,dimension:options.dimension},attackers:new Map(),entities:new Map(entities.map(e=>[e.id,e])),inventory:{equipment:()=>({})},world:{revision:0,blockAt:()=>({name:'air',shapes:[],boundingBox:'empty'})},registry:{entitiesByName:{}}};
const sensor=createEntitySensor(client,{tracker,maxRays:24}),first=sensor.read();assert.ok(first.metrics.rays<=24);
tracker.setScope(options.dimension);for(let i=0;i<10000;i++)tracker.observeEntity({...entities[0],position:{x:i%32,y:64,z:0}},{dimension:options.dimension});
assert.equal(tracker.snapshot().trackedEntities,1);assert.equal(tracker.snapshot().coalesced,9999);
times.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture:'synthetic-entity-perception',entities:entities.length,retained:result.entities.length,selectionP50Ms:times[15],selectionP95Ms:times[29],visibility:first.metrics,coalescedUpdates:tracker.snapshot().coalesced},null,2));
