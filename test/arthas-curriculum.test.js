import test from 'node:test';
import {createHash} from 'node:crypto';
import {migrateCurriculumMemory} from '../src/learning/curriculum.js';
import assert from 'node:assert/strict';

test('curriculum labels can change language without invalidating task progress',()=>{
  const before=[{id:'wood',title:'Original label',task:'wood',size:6}],after=[{id:'wood',title:'Updated label',task:'wood',size:6}],options={window:5,promoteAt:.8,demoteBelow:.2};
  const c=createCurriculum({stages:before,...options});c.record(true);const restored=createCurriculum({stages:after,memory:c.export(),...options});assert.equal(restored.snapshot().episodes,1);assert.equal(restored.current().title,'Updated label');
  const legacy={...c.export(),schemaVersion:1,signature:createHash('sha256').update(JSON.stringify({stages:before,...options})).digest('hex')};
  const migrated=migrateCurriculumMemory({memory:legacy,previousStages:before,stages:after,...options});assert.equal(migrated.schemaVersion,2);assert.equal(migrated.episodes,1);assert.throws(()=>migrateCurriculumMemory({memory:legacy,previousStages:before,stages:[{...after[0],size:12}],...options}),/semantics/);
});
import {createHeadlessEnvironment,createCurriculum,createVectorEnvironment,headlessCurriculumStages,minecraftCurriculumStages,HEADLESS_TASKS,HEADLESS_FEATURES,HEADLESS_ACTIONS,trainCurriculum} from '../src/intelligence.js';
import {createLootReactor,createSurvivalReactor,validateScenario,catalogFromMinecraftData,OVERMIND} from '../overmindmc.js';
import {OMConnect} from '../omconnect/index.js';

test('Version Arthas supplies a valid package version and the requested display name',async()=>{
  const {default:semver}=await import('semver');assert.equal(semver.valid(OVERMIND.version),'1.0.0-Arthas-dev.2');assert.equal(OVERMIND.displayVersion,'v1.0.0Arthas-dev.2');assert.equal(OVERMIND.versionName,'Version Arthas');
});

test('20 curriculum stages are independent valid environments and all ten tasks are attainable',()=>{
  const stages=headlessCurriculumStages();assert.equal(stages.length,20);assert.equal(new Set(stages.map(s=>s.id)).size,20);stages[0].resources.tree=1;assert.equal(headlessCurriculumStages()[0].resources.tree,24);
  for(const {id,title,...options}of headlessCurriculumStages()){const env=createHeadlessEnvironment(options);assert.equal(env.reset().observation.length,HEADLESS_FEATURES.length);}
  for(const task of HEADLESS_TASKS){const env=createHeadlessEnvironment({task,seed:19,maxSteps:1000});let s=env.reset(),final;
    for(let t=0;t<1000;t++){const craft=[9,8,11,7,6,5].find(a=>s.actionMask[a]),[dx,dz,near]=s.observation,action=craft??(near?4:Math.abs(dx)>Math.abs(dz)?dx>0?3:2:dz>0?1:0);const r=env.step(action);if(r.terminated||r.truncated){final=r;break;}s={observation:r.observation,actionMask:r.info.actionMask};}
    assert.equal(final?.info.success,true,task);}
});

test('live curriculum targets are valid real scenarios at every tier',()=>{
  for(const [tier,count]of [['wood',3],['stone',6],['iron',14],['diamond',20]]){const stages=minecraftCurriculumStages({tier});assert.equal(stages.length,count);for(const stage of stages)validateScenario({schemaVersion:1,name:stage.title,steps:[{id:stage.id,type:'resources',targets:stage.targets}]});}
});

test('curriculum gate prevents random-success graduation and memory restores stage history',()=>{
  const stages=[{id:'wood',task:'wood'},{id:'stone',task:'stone'}],c=createCurriculum({stages,window:5});for(let i=0;i<10;i++)c.record(true,{allowPromotion:false});assert.equal(c.snapshot().index,0);c.record(true);assert.equal(c.snapshot().index,1);const saved=c.export(),restored=createCurriculum({stages,window:5,memory:saved});assert.deepEqual(restored.snapshot(),c.snapshot());assert.equal(restored.snapshot().history[0].reason,'promoted');assert.throws(()=>createCurriculum({stages:[{task:'different'}],window:5,memory:saved}),/memory/);
});

test('changing vector stage resets all environments without changing network dimensions',async()=>{
  const pool=createVectorEnvironment({count:16,workers:1});try{const before=await pool.reset();await pool.step(Array(16).fill(10));const after=await pool.setEnvironment({task:'furnace',size:10,maxSteps:400});assert.equal(after.length,16);assert.ok(after.every(r=>r.info.task==='furnace'&&r.info.episode===1&&r.observation.length===before[0].observation.length&&r.actionMask.length===HEADLESS_ACTIONS.length));assert.equal(pool.snapshot().configurations,1);}finally{await pool.close();}
});

test('one batch of old-stage successes can promote only one stage and needs independent validation',async()=>{
  const stages=[{task:'wood'},{task:'stone'},{task:'diamond'}],run=async approved=>{let task;const indices=[],curriculum=createCurriculum({stages,window:5,demoteBelow:0}),policy={act:()=>0,remember:()=>{},train:()=>({loss:0,updates:1,replaySize:16})},environments={setEnvironment:async e=>{task=e.task;return Array.from({length:16},(_,id)=>({id,observation:[1],actionMask:[true]}));},step:async()=>Array.from({length:16},(_,id)=>({id,observation:[2],reward:1,terminated:true,truncated:false,info:{success:true,task,actionMask:[true]}})),reset:async()=>Array.from({length:16},(_,id)=>({id,observation:[1],actionMask:[true]}))};
    await trainCurriculum({policy,environments,curriculum,batches:2,validationEvery:1,validateStage:async()=>approved,onBatch:e=>indices.push(e.curriculum.index)});return indices;};assert.deepEqual(await run(true),[1,2]);assert.deepEqual(await run(false),[0,0]);
});

test('several unreachable drops yield control to progression even when each drop has a different ID',()=>{
  let now=1000;const r=createLootReactor({clock:()=>now}),o={dimension:'minecraft:overworld',self:{position:{x:0,y:64,z:0},health:20,freeInventorySlots:20},inventory:{},drops:[{id:'a',item:'minecraft:oak_sapling',position:{x:2,y:64,z:0},count:1}]};const first=r.react(o).action;r.recordResult({outcome:'failure'},first);o.drops[0].id='b';const second=r.react(o).action;assert.ok(second);r.recordResult({outcome:'failure'},second);o.drops[0].id='c';assert.equal(r.react(o).action,null);now+=11000;assert.ok(r.react(o).action);
});

test('class harvesting switches species after a confirmed unreachable tree',async()=>{
  const c=new OMConnect();Object.assign(c.state,{status:'ready',dimension:'minecraft:overworld',position:{x:.5,y:64,z:.5},health:20});const birch={x:2,y:64,z:0},oak={x:4,y:64,z:0};c.world.blockAt=p=>c.world.Block.fromStateId(c.registry.blocksByName[p.x===2&&p.y===64&&p.z===0?'birch_log':p.x===4&&p.y===64&&p.z===0?'oak_log':p.y<64?'dirt':'air'].defaultState,0);
  const r=createSurvivalReactor({client:c,catalog:catalogFromMinecraftData(c.registry),targets:{'#logs':1},exploration:false}),o={dimension:c.state.dimension,self:c.state,inventory:{},world:{sampledBlocks:[{name:'minecraft:birch_log',position:birch},{name:'minecraft:oak_log',position:oak}]}};const first=r.react(o).action;assert.equal(first.args.block,'minecraft:birch_log');r.recordResult({outcome:'failure',detail:"No reachable position with line of sight to the target block."},first);assert.equal(r.react(o).action.args.block,'minecraft:oak_log');await c.close();
});
