import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSurvivalReactor,catalogFromMinecraftData} from '../overmindmc.js';
import {OMConnect} from '../omconnect/index.js';

// Same current policy with its three per-decision caches disabled, NOT a historical version.
const sourceURL=new URL('../src/survival-brain.js',import.meta.url),source=await readFile(sourceURL,'utf8'),marker='const countCache=new Map(),recipeCache=new Map(),blockCache=new Map();';assert.ok(source.includes(marker));
const control=source.replace(marker,'const noCache=()=>{const m=new Map();m.has=()=>false;return m;};const countCache=noCache(),recipeCache=noCache(),blockCache=noCache();').replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g,(_,quote,spec)=>`from ${quote}${new URL(spec,sourceURL).href}${quote}`);
await mkdir('.cache',{recursive:true});await mkdir('data',{recursive:true});const path=resolve('.cache/decision-uncached.mjs');await writeFile(path,control);const {createSurvivalReactor:uncached}=await import(pathToFileURL(path));
const client=new OMConnect();Object.assign(client.state,{position:{x:.5,y:64,z:.5},health:20,food:20,status:'ready',dimension:'minecraft:overworld'});let reads=0;
client.world.blockAt=p=>{reads++;return client.world.Block.fromStateId(client.registry.blocksByName[p.y<64?'stone':'air'].defaultState,0);};
const catalog=catalogFromMinecraftData(client.registry),observation={dimension:client.state.dimension,self:client.state,inventory:{'minecraft:wooden_pickaxe':1},world:{sampledBlocks:[]}},measure=factory=>{
  const reactor=factory({client,catalog,targets:{cobblestone:16},exploration:false});for(let i=0;i<5;i++)reactor.react(observation);reads=0;const times=[];let action;
  for(let i=0;i<40;i++){const start=performance.now();action=reactor.react(observation).action;times.push(performance.now()-start);}times.sort((a,b)=>a-b);
  return {medianMs:times[20],p95Ms:times[38],blockReadsPerDecision:reads/40,action};
};
try{const before=measure(uncached),after=measure(createSurvivalReactor);assert.deepEqual(after.action,before.action);const report={fixture:'offline known stone terrain; same algorithm, only caches disabled in control',iterations:40,before,after,medianSpeedup:before.medianMs/after.medianMs,readReduction:before.blockReadsPerDecision/after.blockReadsPerDecision};await writeFile('data/decision-speed.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{await client.close();}
