import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package.');
const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'mckudo-package-'));
const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: args[0]==='install'?300000:120000, windowsHide: true });
try {
  const archives = [];
  for (const folder of [root, join(root, 'packages/omconnect')]) {
    const [pack] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], folder));
    archives.push(join(directory, pack.filename));
  }
  const consumer = join(directory, 'consumer'); await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const cacheMode = process.argv.includes('--offline') ? '--offline' : '--prefer-offline';
  run(['install', cacheMode, '--fetch-retries=1', '--fetch-timeout=30000', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', ...archives], consumer);
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {OVERMIND, createMinecraftAgent, defineMission, createNeuralPlanner, createCpuPool, catalogFromMinecraftData, createActionEvidenceMemory, createAgentProgram, validateAgentProgram, startDashboard} from 'overmindmc';
    import {createOMConnect, OMCONNECT, OMActionError} from 'omconnect';
    import {OMCONNECT as bundled} from 'overmindmc/connect';
    import {createOMAdapter} from 'overmindmc/adapters/omconnect';
    import {createSimulator} from 'overmindmc/adapters/simulator';
    import {OMVECTORIZE as coreVector, OMVectorize} from 'overmindmc/vectorize';
    import {OMVECTORIZE as clientVector} from 'omconnect/vectorize';
    import {createMachineGraph,planMachineResources,createCampaignJournal} from 'overmindmc';
    import {createNavigationSession,RegionalRouteGraph,IncrementalRegionPlanner,createNavigationRecovery} from 'overmindmc';
    import {createWorldAtlas,createNeuralNavigator,planFrontierExploration} from 'overmindmc';
    import {createCognitiveEngine,createCognitivePlanner,repairPlan,buildPlannerContext,evaluateCognitiveCheckpoint} from 'overmindmc';
    import {createNavigationSession as standaloneNavigation} from 'omconnect/vectorize';
    import {createDQN,createVectorEnvironment,openWorldStore} from 'overmindmc/intelligence';
    import {loadNativeKernel,createNativeNavigationBackend,NativeFrameDecoder} from 'overmindmc/native';
    assert.equal(typeof createNativeNavigationBackend,'function');assert.equal(typeof NativeFrameDecoder,'function');
    assert.throws(()=>loadNativeKernel(),/Cannot load/,'the source archive does not ship local native binaries');
    const require = createRequire(import.meta.url);
    assert.throws(()=>require.resolve('mineflayer'), {code:'MODULE_NOT_FOUND'});
    assert.equal(OVERMIND.version, ${JSON.stringify(version)});
    assert.equal(OMCONNECT.version, OVERMIND.version); assert.equal(bundled.version, OVERMIND.version);
    assert.equal(coreVector.version, OVERMIND.version); assert.equal(clientVector.version, OVERMIND.version);
    const navigationScope={server:'installed',worldId:'smoke',dimension:'minecraft:overworld',minecraftVersion:'1.21.1'};
    const navigation=createNavigationSession({scope:navigationScope,getBlock:()=>null});
    assert.equal((await navigation.plan({start:{x:0,y:1,z:0},goal:{x:2,y:1,z:0}})).status,'blocked');
    const resumedNavigation=standaloneNavigation({scope:navigationScope,getBlock:()=>null,memory:navigation.exportMemory()});navigation.close();resumedNavigation.close();
    const regions=new RegionalRouteGraph();regions.setEdge('a','b',1);assert.equal((await new IncrementalRegionPlanner(regions).plan('a','b')).cost,1);
    assert.equal(createNavigationRecovery().decide({code:'SERVER_CORRECTION'}).strategy,'reobserve');
    assert.equal(createDQN({inputs:2,actions:2}).predict([0,1]).length,2);
    const environments=createVectorEnvironment({count:4,workers:1});
    try{assert.equal((await environments.reset()).length,4);assert.equal((await environments.step([10,10,10,10])).length,4);}finally{await environments.close();}
    const atlasScope={worldId:'installed',serverId:'test',minecraftVersion:'1.21.1'},map=await openWorldStore({path:':memory:',...atlasScope});
    const atlas=createWorldAtlas({scope:atlasScope,store:map});atlas.observe({dimension:'minecraft:overworld',world:{sampledBlocks:[{name:'minecraft:stone',position:{x:0,y:0,z:0}}]}});assert.ok(atlas.flush()>0);assert.equal(map.readAtlasRecords({dimension:'minecraft:overworld'}).length,1);
    const restoredAtlas=createWorldAtlas({scope:atlasScope,memory:atlas.export()});assert.equal(restoredAtlas.landmarks.entries().length,1);map.close();
    assert.equal(createNeuralNavigator({worldId:'installed'}).export().schemaVersion,3);
    assert.equal(planFrontierExploration({position:{x:0,y:1,z:0},getBlock:()=>null}).status,'blocked');
    const vector=new OMVectorize({getBlock:()=>null});
    assert.equal(vector.plan({start:{x:0,y:0,z:0},goal:{x:1,y:0,z:0}}).status,'blocked');
    const graph=createMachineGraph({schemaVersion:1,minecraftVersion:'1.21.1',recipes:[]});
    assert.equal(planMachineResources({graph,targets:[{id:'example:plate'}]}).status,'blocked');
    assert.equal(createCampaignJournal().snapshot().objective,'enter-end');
    const client = createOMConnect({username:'Atlas'});
    assert.equal(client.dataLoaded, false);
    assert.ok(catalogFromMinecraftData(client.registry).blocks().length > 1000);
    assert.equal(typeof createOMAdapter, 'function'); assert.equal(typeof createSimulator, 'function');
    assert.equal(defineMission([{get:'#logs',count:2}]).steps[0].targets['#logs'], 2);
    const program=validateAgentProgram({schemaVersion:1,name:'Installed program',nodes:[{id:'pause',type:'action',action:{skill:'wait',args:{durationMs:1}}}]},{skills:['wait']});
    const controller=createAgentProgram({program,skills:['wait']});const decision=controller.reactor.react({});controller.recordResult({outcome:'success'},decision.action);assert.equal(controller.snapshot().status,'completed');
    const dashboard=await startDashboard({port:0,manager:{snapshot:()=>({agents:[],log:[]}),close:async()=>{}}});
    try{for(const path of ['/program-builder.js','/vision3d.js','/vendor/three.module.js','/vendor/three.core.js']){const response=await fetch(dashboard.url+path);assert.equal(response.status,200);await response.arrayBuffer();}}finally{await dashboard.close();}
    const evidence = createActionEvidenceMemory({worldId:'package-smoke'});
    evidence.record({agentId:'Atlas',dimension:'minecraft:overworld',action:{skill:'navigate',args:{x:1,y:64,z:0}},failure:new OMActionError('STEP_STALLED','temporary')});
    assert.equal(evidence.snapshot().entries[0].mode,'timer');
    const model = createNeuralPlanner({worldId:'package-smoke'});
    assert.equal(createNeuralPlanner({worldId:'package-smoke',memory:model.export()}).snapshot().samples, 0);
    const cognition=createCognitiveEngine({worldId:'package-smoke'});assert.equal(createCognitiveEngine({worldId:'package-smoke',memory:cognition.export()}).snapshot().records,0);
    const context=buildPlannerContext({observation:{done:false},goal:{id:'done',desired:{fact:'/done',eq:true}},operators:[{id:'work',action:{skill:'work'},effects:[{fact:'/done',set:true}]}],skills:['work']});
    const proposal=await createCognitivePlanner({budgetMs:1000}).plan(context,{signal:new AbortController().signal});assert.deepEqual(proposal.steps,['work']);assert.equal((await repairPlan(context,['work'])).status,'repaired');
    model.setMode('evaluate');assert.equal(evaluateCognitiveCheckpoint({baseline:model.export(),candidate:model.export(),evaluation:{split:'evaluation',source:'unit',records:[]}}).decision,'inconclusive');
    const pool = createCpuPool();
    try { await assert.rejects(pool.run({type:'unknown'}), /Unknown task CPU/); } finally { await pool.close(); }
    const agent = createMinecraftAgent({worldId:'package-smoke'}); await agent.close(); await client.close();
    console.log('Installed packages passed: imports, optional Mineflayer, lazy registry, mission, memory, CPU worker and shutdown.');
  `], { cwd: consumer, encoding: 'utf8', timeout: 30000 });
  console.log(output.trim());
} finally {
  const target = relative(base, resolve(directory));
  assert.ok(target && !target.startsWith('..') && !isAbsolute(target), 'Temporary cleanup escaped its root.');
  await rm(directory, { recursive: true, force: true });
}
