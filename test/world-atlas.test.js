import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { createWorldAtlas, attachWorldAtlas, createSpatialMemory, createAgentMemory, createMinecraftBrain, createAgentManager } from '../overmindmc.js';
import { openWorldStore } from '../src/intelligence.js';
import { OMConnect } from '../omconnect/index.js';

const dimension = 'minecraft:overworld', scope = { serverId: 'local:25565', worldId: 'atlas-tests', minecraftVersion: '1.21.1' };
const p = { x: -1, y: 64, z: -1 }, q = { x: 0, y: 64, z: -1 }, stone = { name: 'stone', boundingBox: 'block' };
const observation = (blocks = [{ name: 'minecraft:stone', position: p }], d = dimension) => ({ dimension: d, self: { position: p }, world: { sampledBlocks: blocks } });
const transition = (extra = {}) => ({ dimension, from: p, to: q, kind: 'walk', outcome: 'success', health: 20, healthAfter: 20, durationMs: 200, ...extra });

test('atlas regions count observed samples without treating a region as fully loaded', () => {
  const atlas = createWorldAtlas({ scope, clock: () => 10000 });
  atlas.observe(observation(), { getBlock: () => stone });
  const r = atlas.regionAt({ dimension, position: p });
  assert.deepEqual(r.position, { x: -1, y: 4, z: -1 }); assert.equal(r.cells.length, 1);
  assert.equal(r.observedFractionLowerBound, 1 / 4096); assert.equal(r.requiresRevalidation, true);
  atlas.observe(observation(), { getBlock: () => null });
  assert.equal(atlas.regionAt({ dimension, position: p }).cells.length, 1);
  assert.equal(atlas.landmarks.entries().length, 1); // Unknown preserves an advisory landmark.
  atlas.observe(observation([{ name: 'minecraft:air', position: p }]), { getBlock: () => ({ name: 'air' }) });
  assert.equal(atlas.landmarks.entries().length, 0);
  assert.equal(atlas.regionAt({ dimension: 'minecraft:the_nether', position: p }), null);
  r.cells.push(10); assert.equal(atlas.regionAt({ dimension, position: p }).cells.length, 1);
});

test('directed return corridors never reverse an unobserved drop and edits revoke related hints', () => {
  let now = 10000; const atlas = createWorldAtlas({ scope, clock: () => now });
  atlas.recordTransition(transition());
  assert.equal(atlas.returnCorridor({ dimension, from: p, to: q }).status, 'hint');
  assert.equal(atlas.returnCorridor({ dimension, from: q, to: p }).status, 'unavailable');
  atlas.recordTransition(transition({ from: q, to: p }));
  assert.equal(atlas.returnCorridor({ dimension, from: q, to: p }).status, 'hint');
  assert.equal(atlas.invalidate({ dimension, position: { x: 100, y: 64, z: 100 } }), 0);
  now++; assert.equal(atlas.invalidate({ dimension, position: { ...q, y: q.y - 1 } }), 2);
  assert.equal(atlas.returnCorridor({ dimension, from: q, to: p }).status, 'unavailable');
  assert.equal(atlas.recordTransition(transition({ outcome: 'failure', failureCode: 'SERVER_CORRECTION' })), false);
  assert.equal(atlas.recordTransition(transition({ outcome: 'cancelled' })), false);
  atlas.recordTransition(transition()); assert.equal(atlas.returnCorridor({ dimension, from: p, to: q }).requiresRevalidation, true);
  atlas.recordTransition(transition({ healthAfter: 16 }));
  assert.equal(atlas.returnCorridor({ dimension, from: p, to: q }).status, 'unavailable');
});

test('atlas TTL, bounded evidence, legacy migration and schema validation survive serialization', () => {
  let now = 10000; const clock = () => now;
  const legacy = createSpatialMemory({ worldId: scope.worldId, clock }); legacy.observe(observation());
  const a = createWorldAtlas({ scope, memory: legacy.export(), clock, maxAgeMs: 1000, maxRegions: 16, maxTransitions: 16 });
  assert.equal(a.snapshot().migrated, true); assert.deepEqual(a.landmarks.export(), legacy.export());
  a.markAnchor({ id: 'home', position: p, dimension, kind: 'base' }); a.recordTransition(transition());
  for (let i = 0; i < 30; i++) a.observe(observation([{ name: 'minecraft:stone', position: { x: i * 32, y: 64, z: 0 } }]));
  assert.equal(a.snapshot().regions, 16);
  const memory = a.export(), copy = structuredClone(memory), b = createWorldAtlas({ scope, memory, clock });
  assert.equal(b.landmarks.entries().length, legacy.entries().length + 30); assert.equal(b.returnCorridor({ dimension, from: p, to: q }).status, 'hint');
  assert.deepEqual(memory, copy);
  for (const changed of [{ worldId: 'other' }, { serverId: 'other:25565' }, { minecraftVersion: '1.20.4' }]) assert.throws(() => createWorldAtlas({ scope: { ...scope, ...changed }, memory, clock }), /scope|world/i);
  const bad = structuredClone(memory); bad.transitions[0].successes = -1; assert.throws(() => createWorldAtlas({ scope, memory: bad, clock }), /transition/);
  const duplicate = structuredClone(memory); duplicate.regions.push(duplicate.regions[0]); assert.throws(() => createWorldAtlas({ scope, memory: duplicate, clock }), /Duplicate/);
  now += 1001; assert.equal(a.snapshot().regions, 0); assert.equal(a.snapshot().transitions, 0); assert.equal(a.snapshot().anchors, 0);
});

test('SQLite schema-one migration retains blocks and air tombstones; atlas writes are scoped and atomic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overmind-atlas-')), path = join(dir, 'atlas.sqlite'); let store;
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE blocks(dimension TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,name TEXT NOT NULL,seen INTEGER NOT NULL,agent TEXT NOT NULL,PRIMARY KEY(dimension,x,y,z));');
  old.prepare('INSERT INTO metadata VALUES(?,?)').run('identity', JSON.stringify({ schemaVersion: 1, ...scope }));
  old.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?,?)').run(dimension, p.x, p.y, p.z, 'minecraft:air', 9500, 'Alice'); old.close();
  try {
    store = await openWorldStore({ path, ...scope, clock: () => 10000 });
    store.observe({ dimension, blocks: [{ name: 'minecraft:stone', position: p }], observedAt: 9000 });
    assert.equal(store.query({ dimension, near: p }).length, 0);
    const atlas = createWorldAtlas({ scope, store, clock: () => 10000 }); atlas.observe(observation()); atlas.recordTransition(transition());
    assert.ok(atlas.flush() >= 2); assert.equal(atlas.snapshot().pendingWrites, 0);
    assert.throws(() => store.writeAtlasRecords([{ kind: 'region', dimension, key: 'bad', observedAt: 10000, value: {} }]), /value/);
    const records = store.readAtlasRecords({ dimension }); assert.ok(records.length >= 2);
    store.close(); store = await openWorldStore({ path, ...scope, clock: () => 10000 });
    const restored = createWorldAtlas({ scope, store, clock: () => 10000 }); assert.ok(restored.hydrate({ dimension }) >= 2);
    assert.equal(restored.returnCorridor({ dimension, from: p, to: q }).status, 'hint');
    const staleMemory=restored.export();restored.invalidate({dimension,position:p});restored.flush();
    const invalid=store.readAtlasRecords({dimension,kind:'transition'})[0];assert.equal(invalid.value.valid,false);
    store.writeAtlasRecords([{...invalid,value:{...invalid.value,valid:true}}]);assert.equal(store.readAtlasRecords({dimension,kind:'transition'})[0].value.valid,false);
    const stale=createWorldAtlas({scope,store,memory:staleMemory,clock:()=>10000});stale.hydrate({dimension});assert.equal(stale.returnCorridor({dimension,from:p,to:q}).status,'unavailable');
    assert.equal(store.readAtlasRecords({ dimension: 'minecraft:the_end' }).length, 0);
    store.close(); store = null;
    await assert.rejects(openWorldStore({ path, ...scope, worldId: 'foreign' }), /identity/);
    const db = new DatabaseSync(path); assert.equal(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get().value).worldId, scope.worldId); db.close();
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('rejecting a foreign schema-one database does not migrate its schema',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'overmind-atlas-identity-')),path=join(dir,'old.sqlite');
  try{
    let db=new DatabaseSync(path);db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');db.prepare('INSERT INTO metadata VALUES(?,?)').run('identity',JSON.stringify({schemaVersion:1,...scope}));db.close();
    await assert.rejects(openWorldStore({path,...scope,worldId:'foreign'}),/identity/);
    db=new DatabaseSync(path);assert.equal(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='identity'").get().value).schemaVersion,1);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='atlas_records'").get(),undefined);db.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('atlas attachment shares the existing executor and releases event listeners', () => {
  const client = new EventEmitter(); client.state = { dimension };
  const atlas = createWorldAtlas({ scope }); const detach = attachWorldAtlas(client, atlas);
  client.emit('navigationStep', transition()); assert.equal(atlas.snapshot().transitions, 1);
  client.emit('block', { position: p }); assert.equal(atlas.snapshot().invalidations, 1);
  detach(); detach(); assert.equal(client.listenerCount('navigationStep'), 0); assert.equal(client.listenerCount('block'), 0);
});

test('standard brain updates atlas before reactions, and stop/start does not duplicate learning listeners', async () => {
  const client = new OMConnect({ username: 'AtlasB', version: '1.21.1' });
  client.state = { ...client.state, status: 'ready', health: 20, food: 20, position: { x: 0, y: 64, z: 0 }, dimension };
  client.world.findBlocks = async () => ({ blocks: [], revision: 0, truncated: false });
  client.execute = async () => ({ ok: true });
  const brain = createMinecraftBrain({ client, worldId: scope.worldId, storage: false, survival: false, computation: false });
  await brain.tick(); assert.ok(brain.atlas.snapshot().regions > 0);
  assert.equal(client.listenerCount('navigationStep'), 2); await brain.stop(); assert.equal(client.listenerCount('navigationStep'), 0);
  brain.start(); assert.equal(client.listenerCount('navigationStep'), 2); await brain.stop(); assert.equal(client.listenerCount('navigationStep'), 0);
});

test('agent persistence has a configurable bounded envelope without changing schema one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overmind-agent-atlas-'));
  try {
    const memory = createAgentMemory(dir, scope.worldId, { maxBytes: 4096 }), atlas = createWorldAtlas({ scope }); atlas.recordTransition(transition());
    await memory.save('Alice', { atlas: atlas.export() }); const loaded = await memory.load('Alice');
    assert.equal(loaded.schemaVersion, 1); assert.equal(loaded.atlas.schemaVersion, 2);
    assert.throws(() => memory.save('Alice', { payload: 'x'.repeat(4096) }), /limit/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manager shutdown/restart preserves atlas, legacy landmarks and schema-three neural memory together',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'overmind-manager-atlas-'));let manager;
  const options={count:1,names:['Alice'],worldId:scope.worldId,memoryDirectory:dir,connection:{host:'127.0.0.1',port:25565,version:'1.21.1'},brainOptions:{storage:false,survival:false,loot:false,night:false,needs:false,hunting:false,recovery:false,equipment:false,computation:false},
    createClient:settings=>{const c=new OMConnect(settings);c.connect=async()=>{c.state={...c.state,status:'ready',dimension,health:20,food:20,position:p};};c.close=async()=>{c.state.status='disconnected';c.emit('end');};return c;},
    createBrain:settings=>{const b=createMinecraftBrain(settings);b.start=()=>{};return b;}};
  try{
    manager=createAgentManager(options);await manager.ready;await manager.execute('Alice','connect');await manager.execute('Alice','start');
    let brain=manager.entries.get('Alice').brain;brain.atlas.observe(observation());brain.atlas.recordTransition(transition());brain.neural.record(transition());
    await manager.close();manager=createAgentManager(options);await manager.ready;await manager.execute('Alice','connect');await manager.execute('Alice','start');
    brain=manager.entries.get('Alice').brain;assert.equal(brain.atlas.snapshot().transitions,1);assert.equal(brain.spatial.entries().length,1);assert.equal(brain.neural.snapshot().samples,1);assert.equal(brain.neural.export().schemaVersion,3);assert.equal(manager.snapshot().agents[0].atlas.regions,1);
    await manager.close();manager=createAgentManager({...options,connection:{...options.connection,host:'other-server'}});await manager.ready;await assert.rejects(manager.execute('Alice','connect'),/scope/);
  }finally{await manager?.close();await rm(dir,{recursive:true,force:true});}
});
