import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createNeuralNavigator, createNavigationContextReader, frontierCandidates, planFrontierExploration, createExplorationPlanner, createCpuPool } from '../overmindmc.js';
import { captureVoxels, readVoxelSnapshot } from '../src/voxel-snapshot.js';

const air = { name: 'air', boundingBox: 'empty', shapes: [], stateId: 0 }, stone = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], stateId: 1 };
const position = { x: 0, y: 64, z: 0 }, dimension = 'minecraft:overworld';
const flat = p => p.y < 64 ? stone : air;
const walk = { from: position, to: { ...position, x: 1 }, kind: 'walk', dimension, health: 20, food: 20 };
const context = extra => ({ loaded: true, signature: 'a1', slipperiness: .6, speed: .1, headroom: 3, water: false, lava: false, slow: false, fallHeight: 0, hazards: 0, hostiles: 0, historyFailureRate: 0, historyConfidence: 0, ...extra });

test('context network learns held-out risk, duration and damage; uncertainty gates untrained estimates', () => {
  const model = createNeuralNavigator({ worldId: 'context' }), safe = context(), dangerous = context({ signature: 'b2', slipperiness: .98, fallHeight: 8, headroom: 1, hazards: 4 });
  assert.equal(model.assess({ ...walk, context: safe }).cost, 0);
  for (let i = 0; i < 200; i++) {
    model.record({ ...walk, from: { ...position, z: i % 5 }, to: { ...walk.to, z: i % 5 }, context: safe, outcome: 'success', durationMs: 180, healthAfter: 20 });
    model.record({ ...walk, from: { ...position, z: i % 5 }, to: { ...walk.to, z: i % 5 }, context: dangerous, outcome: 'failure', durationMs: 4000, healthAfter: 14 });
  }
  // Different coordinates and slightly changed speed are not exact replay entries or failure bans.
  const held = { ...walk, from: { ...position, z: 30 }, to: { ...walk.to, z: 30 } };
  const a = model.assess({ ...held, context: context({ speed: .12 }) }), b = model.assess({ ...held, context: { ...dangerous, speed: .12 } });
  assert.equal(a.rememberedFailures, 0); assert.equal(b.rememberedFailures, 0); assert.ok(a.trained && b.trained);
  assert.ok(b.failureProbability > a.failureProbability + .35); assert.ok(b.expectedTimeMs > a.expectedTimeMs * 2);
  assert.ok(b.expectedDamage > a.expectedDamage + 2); assert.ok(b.cost > a.cost);
  const memory = model.export(), restored = createNeuralNavigator({ worldId: 'context', memory });
  assert.deepEqual(restored.assess({ ...held, context: dangerous }), model.assess({ ...held, context: dangerous }));
  assert.equal(memory.schemaVersion, 3); assert.equal(model.snapshot().contextual.samples, 400);
});

test('context failure bans follow geometry and skip unloaded, dynamic or cancelled evidence', () => {
  const model = createNeuralNavigator({ worldId: 'geometry' }), c = context();
  model.record({ ...walk, context: c, outcome: 'failure' });
  assert.equal(model.assess({ ...walk, context: c }).rememberedFailures, 1);
  assert.equal(model.assess({ ...walk, context: { ...c, signature: 'c3' } }).rememberedFailures, 0);
  for (const failureCode of ['STALE_WORLD', 'SERVER_CORRECTION', 'UNLOADED', 'DYNAMIC_OBSTACLE', 'OCCUPIED']) assert.equal(model.record({ ...walk, context: c, outcome: 'failure', failureCode }), false);
  assert.equal(model.record({ ...walk, context: { ...c, loaded: false }, outcome: 'failure' }), false);
  assert.equal(model.record({ ...walk, context: c, outcome: 'cancelled' }), false);
  assert.equal(model.snapshot().contextual.samples, 1);
  const memory = model.export(); memory.contextual.weights.v[0][0] = null;
  assert.throws(() => createNeuralNavigator({ worldId: 'geometry', memory }), /Contextual/);
  const old = model.export(); old.schemaVersion = 2; delete old.contextual;
  const upgraded = createNeuralNavigator({ worldId: 'geometry', memory: old });
  assert.deepEqual(upgraded.export().weights, old.weights); assert.equal(upgraded.snapshot().contextual.samples, 0);
});

test('estimated timings never become duration training labels', () => {
  const model = createNeuralNavigator({ worldId: 'labels' });
  model.record({ ...walk, context: context(), outcome: 'success', durationMs: 500, healthAfter: 20, timingEstimated: true, damageEstimated: true });
  assert.equal(model.snapshot().contextual.timedSamples, 0); assert.equal(model.snapshot().contextual.damageSamples, 0);
});

test('context cache includes dimension, block state and shapes, with bounded read cost', () => {
  let changed = false;
  const client = { state: { dimension, velocity: { x: .1 } }, entities: new Map(), world: { revision: 0, blockAt: p => changed && p.y === 63 ? { ...stone, stateId: 2, shapes: [[0, 0, 0, 1, .5, 1]] } : flat(p) } };
  const reader = createNavigationContextReader({ client }); const a = reader.read(walk.from, walk.to);
  for (let i = 0; i < 100; i++) reader.read(walk.from, walk.to);
  assert.equal(reader.snapshot().reads, 8); assert.equal(reader.snapshot().hits, 100);
  changed = true; client.world.revision++; assert.notEqual(reader.read(walk.from, walk.to).signature, a.signature);
  client.state.dimension = 'minecraft:the_nether'; reader.read(walk.from, walk.to); assert.equal(reader.snapshot().reads, 24);
  client.world.blockAt = () => null; client.world.revision++; assert.equal(reader.read(walk.from, walk.to).loaded, false);
});

test('frontier ranking respects occlusion, hazards, visits and unknown collision geometry', () => {
  const open = p => p.x >= 8 ? null : flat(p), wall = p => p.x === 5 && p.y >= 64 ? stone : p.x > 5 ? null : flat(p);
  const options = { position, radius: 8, maxCandidates: 64 };
  const visible = frontierCandidates({ ...options, getBlock: open }); assert.ok(visible.some(c => c.informationGain > 0));
  const occluded = frontierCandidates({ ...options, getBlock: wall }); assert.ok(occluded.every(c => c.informationGain === 0));
  const first = visible[0], revisited = frontierCandidates({ ...options, getBlock: open, visited: [first.p] });
  assert.ok(revisited.every(c => JSON.stringify(c.p) !== JSON.stringify(first.p)));
  const unknown = planFrontierExploration({ ...options, getBlock: () => null }); assert.equal(unknown.status, 'blocked');
  const plan = planFrontierExploration({ ...options, getBlock: open }); assert.equal(plan.status, 'planned');
  assert.ok(plan.route.steps.every(s => s.position.x < 8));
});

test('shared frontier search never exceeds its global expansion budget and favors accessible caves', () => {
  const cave = p => p.y < (p.x <= 0 ? 64 : 61) ? stone : air;
  const options = { position, mode: 'ores', radius: 8, maxCandidates: 32, maxNodes: 2000, getBlock: cave };
  const allowed = planFrontierExploration({ ...options, maxDrop: 3 }); assert.equal(allowed.status, 'planned'); assert.equal(allowed.target.y, 61);
  const safe = planFrontierExploration({ ...options, maxDrop: 1 }); assert.ok(!safe.target || safe.target.y >= 64);
  const tiny = planFrontierExploration({ ...options, maxNodes: 1 }); assert.equal(tiny.status, 'blocked'); assert.ok(tiny.frontier.visitedNodes <= 1);
});

test('voxel snapshot boundaries do not masquerade as unexplored world frontiers', async () => {
  const snapshot = await captureVoxels({ position, radius: 8, getBlock: flat });
  const candidates = frontierCandidates({ position, radius: 8, maxCandidates: 64, getBlock: readVoxelSnapshot(snapshot) });
  assert.ok(candidates.length); assert.ok(candidates.every(c => c.informationGain === 0));
});

test('exploration cache invalidates when visits or policy revisions change without terrain changes', async () => {
  const pool = createCpuPool(), world = { dimension, revision: 0, blockAt: flat }, planner = createExplorationPlanner({ world, pool });
  const options = { position, radius: 8, maxNodes: 1500 };
  const wait = async o => { let result; for (let i = 0; i < 200; i++) { result = planner.poll(o); if (result.status !== 'pending') return result; await delay(10); } throw new Error('Exploration did not complete.'); };
  try {
    let costCalls=0;
    const a = await wait({...options,candidateCost:()=>{costCalls++;return 0;}}); assert.equal(a.status, 'planned'); assert.equal(a.frontier.strategy, 'information-gain');assert.ok(costCalls>0&&costCalls<=64);
    const visited = { ...options, visited: [a.target] }; assert.equal(planner.poll(visited).status, 'pending');
    const b = await wait(visited); assert.notDeepEqual(b.target, a.target);
    assert.equal(planner.poll({ ...visited, policyRevision: 1 }).status, 'pending');
    await wait({ ...visited, policyRevision: 1 }); assert.ok(planner.snapshot().stale >= 2);
    const bad = await wait({ ...options, policyRevision: 2, candidateCost: () => NaN }); assert.equal(bad.status, 'blocked'); assert.match(bad.reason, /candidateCost/);
  } finally { planner.close(); await pool.close(); }
});

test('older custom CPU pools retain their original job/result contract',async()=>{
  const pool={run:async input=>{assert.equal(input.phase,undefined);assert.equal(input.options.strategy,'legacy');return {status:'blocked',reason:'custom fixture',target:null,attempts:0};}},world={dimension,revision:0,blockAt:flat};
  const planner=createExplorationPlanner({world,pool});const options={position,radius:8};
  try{
    planner.poll(options);let result;for(let i=0;i<50;i++){await delay(5);result=planner.poll(options);if(result.status!=='pending')break;}
    assert.equal(result.reason,'custom fixture');assert.throws(()=>planner.poll({...options,strategy:'frontier'}),/rankFrontiers/);
  }finally{planner.close();}
});
