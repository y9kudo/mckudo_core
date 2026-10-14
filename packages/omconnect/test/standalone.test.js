import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import minecraftData from 'minecraft-data';
import { OMConnect, OMWorld, OMPeer, createFleet, stepPhysics, environmentAt, solveAim, traceProjectile, projectileProfile } from '../index.js';
import {observeAgent} from '../src/observation.js';
const air = { name: 'air', shapes: [], boundingBox: 'empty' }, stone = { name: 'stone', shapes: [[0,0,0,1,1,1]], boundingBox: 'block' };
const flat = p => p.y < 1 ? stone : air;
const state = (y = 1) => ({ position: { x: .5, y, z: .5 }, velocity: { x: 0, y: 0, z: 0 }, onGround: y === 1, health: 20 });
test('observation exposes sheep wool color and sheared flag for bed planning',()=>{
  const c={options:{version:'1.21.1'},state:{...state(),dimension:'minecraft:overworld'},inventory:{snapshot:()=>({}),equipment:()=>({}),slots:Array(46).fill(null)},
    entities:new Map([[1,{id:'1',name:'sheep',kind:'entity',position:{x:2,y:1,z:0},velocity:{x:0,y:0,z:0},metadata:{wool:0x13}}]]),players:{snapshot:()=>[]},attention:{last:null},containers:{observations:new Map()},time:{},endgame:{},world:{revision:0,columns:new Map()},attackers:new Map()};
  const sheep=observeAgent(c).entities[0];assert.equal(sheep.woolColor,3);assert.equal(sheep.sheared,true);
});
test('the standalone package source has no imports of OvermindMC or Mineflayer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.name, 'omconnect'); assert.equal(pkg.dependencies.mckudo, undefined); assert.equal(pkg.dependencies.mineflayer, undefined);
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:mckudo|mineflayer)(?:['"]|\/)/, file);
    const root=fileURLToPath(new URL('../',import.meta.url));
    for(const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)){
      const target=relative(root,resolve(root,'src',match[1]));
      assert.ok(target!== '..'&&!target.startsWith('..\\')&&!target.startsWith('../')&&!isAbsolute(target),`${file}: import leaves standalone package`);
    }
  }
});
test('fleet creates exactly 1–20 unique English clients and cleans every connection after a failure', async () => {
  assert.throws(() => createFleet({ count: 21 })); assert.throws(() => createFleet({ count: 2, names: ['Alice', 'alice'] }));
  const calls = [], fleet = createFleet({ count: 20, createClient: o => ({ async connect() { calls.push(o.username); }, async close() { calls.push('closed:' + o.username); }, snapshot() { return { name: o.username }; } }) });
  await fleet.connect(); assert.equal(calls.length, 20); assert.equal(fleet.agents.size, 20); await fleet.close(); assert.equal(calls.length, 40);
  let closed = 0;
  const failed = createFleet({ count: 3, names:['Alice','Blake','Charlie'], createClient: o => ({ async connect() { if (o.username === 'Blake') throw new Error('offline'); }, async close() { closed++; } }) });
  await assert.rejects(failed.connect(), /offline/); assert.equal(closed, 3);
});
test('peers settle simultaneous claims identically despite reordering, replay and expiration', () => {
  let now = 1000; const messages = [], peers = ['Alice','Blake'].map(id => new OMPeer({ id, team: 'test', peers: ['Alice','Blake'], clock: () => now, send: e => messages.push(e) }));
  const a = peers[0].claim('tree/1'), b = peers[1].claim('tree/1');
  peers[0].receive(b); peers[1].receive(a); assert.equal(peers[0].owner('tree/1'), null);
  now += 101; assert.equal(peers[0].owner('tree/1'), 'Alice'); assert.equal(peers[1].owner('tree/1'), 'Alice');
  const release = peers[0].release('tree/1'); peers[1].receive(release); assert.equal(peers[1].owner('tree/1'), 'Blake');
  assert.equal(peers[1].receive(a), false); assert.equal(peers[1].receive({ ...a, team: 'other' }), false);
  now += 31000; assert.equal(peers[1].owner('tree/1'), null); assert.equal(peers[1].receive(b), false);
  peers.forEach(p => p.close());
});

test('all twenty peers agree on the lowest cost resource bidder',async()=>{
  const fleet=createFleet({count:20,settleMs:0,createClient:()=>({async close(){}})}),peers=[...fleet.peers.values()];
  for(let i=0;i<peers.length;i++)peers[i].claim('block/minecraft:overworld/1/64/1',{bid:20-i});
  assert.ok(peers.every(p=>p.owner('block/minecraft:overworld/1/64/1')==='Theo'));
  assert.equal(peers.filter(p=>p.owns('block/minecraft:overworld/1/64/1')).length,1);await fleet.close();
});
test('fleet routes private JSON outside Minecraft and isolates caller mutations', async () => {
  let packets = 0; const f = createFleet({ count: 3, names:['Alice','Blake','Charlie'], createClient: () => ({ async connect() {}, async close() {}, write() { packets++; } }) });
  const received = []; for (const [name, p] of f.peers) p.on('message', e => received.push([name, e]));
  const payload = { blocks: ['birch_log'] }; f.peers.get('Alice').send('discovery', payload, { to: 'Blake' }); payload.blocks.push('fake');
  assert.deepEqual(received.map(r => r[0]), ['Blake']); assert.deepEqual(received[0][1].payload.blocks, ['birch_log']); assert.equal(packets, 0); await f.close();
});
test('fluid surface height excludes a player above shallow water; unknown chunks freeze', () => {
  const shallow = { ...air, name: 'water', getProperties: () => ({ level: 7 }) };
  assert.equal(environmentAt({ x: .5, y: .5, z: .5 }, p => p.y === 0 ? shallow : air).medium, 'air');
  assert.equal(environmentAt({ x: .5, y: .05, z: .5 }, p => p.y === 0 ? shallow : air).medium, 'water');
  assert.equal(stepPhysics(state(), { x: 1 }, () => null).frozen, true);
});
test('water swimming and lava drag differ; lava danger does not fabricate server health', () => {
  const liquid = n => () => ({ ...air, name: n, getProperties: () => ({ level: 0 }) });
  let w = state(3), l = state(3);
  for (let i = 0; i < 10; i++) { w = stepPhysics(w, { x: 1, jump: true }, liquid('water')); l = stepPhysics(l, { x: 1, jump: true }, liquid('lava')); }
  assert.ok(w.position.y > 3); assert.ok(w.position.x > l.position.x); assert.equal(l.environment.hazardous, true); assert.equal(l.health, 20);
});
test('slime bounces unless sneaking; honey reduces jump; web arrests momentum; ice retains inertia', () => {
  const surface = n => p => p.y < 1 ? { ...stone, name: n } : air;
  const falling = { ...state(1.2), velocity: { x: 0, y: -.5, z: 0 } };
  assert.ok(stepPhysics(falling, {}, surface('slime_block')).velocity.y > 0);
  assert.ok(stepPhysics(falling, { sneak: true }, surface('slime_block')).velocity.y < 0);
  assert.ok(stepPhysics(state(), { jump: true }, surface('honey_block')).position.y < stepPhysics(state(), { jump: true }, flat).position.y);
  const fast = { ...state(3), velocity: { x: 1, y: -.5, z: 0 } }, web = stepPhysics(fast, {}, () => ({ ...air, name: 'cobweb' }));
  assert.ok(web.position.x < 1); assert.equal(web.velocity.x, 0); assert.ok(web.position.y > 2.9);
  const slide = { ...state(), velocity: { x: .5, y: -.08, z: 0 } };
  assert.ok(stepPhysics(slide, {}, surface('ice')).velocity.x > stepPhysics(slide, {}, flat).velocity.x);
});
test('ballistics leads a moving target; independent integration reaches the predicted point', () => {
  const input = { origin: { x: 0, y: 2, z: 0 }, target: { x: 24, y: 2, z: 0 }, targetVelocity: { x: 0, y: 0, z: .12 }, getBlock: () => air };
  for (const weapon of ['bow', 'crossbow', 'trident']) {
    const shot = solveAim({ ...input, weapon }); assert.equal(shot.status, 'aimed'); assert.ok(shot.predicted.z > .5); assert.equal(shot.hitConfirmed, false);
    let p = { ...input.origin }, v = { ...shot.velocity }, t = 0;
    const profile = projectileProfile(weapon);
    while (t < shot.ticks) { const dt = Math.min(1, shot.ticks - t); for (const k of ['x','y','z']) { p[k] += v[k] * dt; v[k] *= .99; } v.y -= profile.gravity; t += dt; }
    assert.ok(Math.hypot(p.x - shot.predicted.x, p.y - shot.predicted.y, p.z - shot.predicted.z) < .01);
  }
});
test('projectiles reject unknown paths, thin obstacles and impossible interception', () => {
  const origin = { x: .5, y: 2, z: .5 }, target = { x: 20, y: 2, z: .5 };
  assert.equal(solveAim({ origin, target, getBlock: () => null }).status, 'blocked');
  const thin = p => p.x === 1 ? { ...stone, shapes: [[.49,0,0,.5,1,1]] } : air;
  assert.equal(traceProjectile({ origin, velocity: { x: 3, y: 0, z: 0 }, ticks: 1, getBlock: thin }).status, 'blocked');
  assert.equal(solveAim({ origin, target: { x: 10000, y: 2, z: 0 }, getBlock: () => air }).status, 'blocked');
});
test('world searches #logs and filters actual block state properties without a core catalog', async () => {
  const registry = minecraftData('1.21.1'), world = new OMWorld(registry), column = new world.Chunk({ minY: -64, worldHeight: 384 });
  column.setBlockStateId({ x: 1, y: 64, z: 1 }, registry.blocksByName.birch_log.defaultState);
  column.setBlockStateId({ x: 10, y: 64, z: 1 }, registry.blocksByName.oak_log.defaultState); world.load({ x: 0, z: 0, chunkData: column.dump() });
  const result = await world.findBlocks({ classes: ['#logs'], position: { x: .5, y: 64, z: 1.5 }, properties: { axis: 'y' } });
  assert.equal(result.blocks[0].name, 'minecraft:birch_log'); assert.equal(result.blocks[0].properties.axis, 'y');
  await assert.rejects(world.findBlocks({ classes: ['#invented'], position: { x: 0, y: 64, z: 0 } }));
});
test('custom skills use the same cancellation lock and bounded action trace', async () => {
  const c = new OMConnect(); c.state.status = 'ready'; c.client = { state: 'play', end() {}, write() {} };
  c.registerSkill('inspect', () => ({ observed: true }));
  assert.deepEqual(await c.execute({ skill: 'inspect' }), { observed: true }); assert.equal(c.trace[0].outcome, 'success');
  assert.throws(() => c.registerSkill('dig', () => {})); await c.close();
});
function armed(weapon, charged = false) {
  const c = new OMConnect(), packets = [];
  c.state = { ...c.state, ...state(), status: 'ready', health: 20, food: 20 };
  c.world = { blockAt: flat };
  const slot = (name, count, components = []) => ({ itemCount: count, itemId: c.registry.itemsByName[name].id, addedComponentCount: components.length, removedComponentCount: 0, components, removeComponents: [] });
  const components = charged ? [{ type: 'charged_projectiles', data: { projectiles: [slot('arrow', 1)] } }] : [];
  c.inventory.updateSlot({ windowId: 0, slot: 36, stateId: 1, item: slot(weapon, 1, components) });
  c.inventory.updateSlot({ windowId: 0, slot: 37, stateId: 2, item: slot('arrow', 3) });
  c.entities.set(42, { id: '42', name: 'zombie', kind: 'entity', position: { x: 20, y: 1, z: .5 }, velocity: { x: 0, y: 0, z: 0 }, metadata: {} });
  c.client = { state: 'play', end() {}, write(name, packet) { packets.push({ name, packet }); c.emit('sent', { name, packet }); } };
  return { c, packets, slot };
}
test('cancelling a drawn bow switches slots and never releases an arrow at the abandoned target', async () => {
  const { c, packets } = armed('bow');
  const started = new Promise(resolve => c.on('sent', e => { if (e.name === 'use_item') resolve(); }));
  const shot = c.execute({ skill: 'shoot', args: { entityId: '42' } }); const rejected = assert.rejects(shot, /priority/);
  await started; await c.execute({ skill: 'look', args: { x: 1, y: 2, z: 0 } }, { priority: 100 }); await rejected;
  assert.equal(packets.some(e => e.name === 'block_dig' && e.packet.status === 5), false);
  assert.ok(packets.some(e => e.name === 'held_item_slot' && e.packet.slotId === 1)); assert.equal(c.trace[0].outcome, 'cancelled'); await c.close();
});
test('loaded crossbow fires once and distinguishes ammunition confirmation from target damage', async () => {
  const { c, packets, slot } = armed('crossbow', true);
  c.on('sent', e => { if (e.name === 'use_item') c.inventory.updateSlot({ windowId: 0, slot: 36, stateId: 3, item: slot('crossbow', 1) }); });
  const result = await c.execute({ skill: 'shoot', args: { entityId: '42', weapon: 'crossbow' } });
  assert.equal(result.shotServerConfirmed, true); assert.equal(result.hitConfirmed, false); assert.equal(packets.filter(e => e.name === 'use_item').length, 1); await c.close();
});
test('moving dragon gets a final current aim and releases one arrow',async()=>{
  const {c,packets,slot}=armed('bow');
  Object.assign(c.entities.get(42),{name:'ender_dragon',metadata:{phase:0}});
  const original=c.waitForLook.bind(c);
  c.waitForLook=async options=>{await original(options);c.entities.get(42).position.z+=1.5;};
  c.on('sent',e=>{if(e.name==='block_dig'&&e.packet.status===5)c.inventory.updateSlot({windowId:0,slot:37,stateId:4,item:slot('arrow',2)});});
  const result=await c.execute({skill:'shoot',args:{entityId:'42'}});
  assert.equal(result.shotServerConfirmed,true);
  assert.equal(packets.filter(e=>e.name==='block_dig'&&e.packet.status===5).length,1);
  await c.close();
});
test('Infinity bow confirms a shot from server durability despite unchanged arrow count',async()=>{
  const {c,packets,slot}=armed('bow');
  const before=slot('bow',1,[{type:'damage',data:4}]);
  c.inventory.updateSlot({windowId:0,slot:36,stateId:3,item:before});
  c.on('sent',e=>{if(e.name==='block_dig'&&e.packet.status===5)c.inventory.updateSlot({windowId:0,slot:36,stateId:4,item:slot('bow',1,[{type:'damage',data:5}])});});
  const result=await c.execute({skill:'shoot',args:{entityId:'42'}});
  assert.equal(result.shotServerConfirmed,true);
  assert.equal(c.inventory.count('arrow'),3);
  assert.equal(packets.filter(e=>e.name==='block_dig'&&e.packet.status===5).length,1);
  await c.close();
});
test('perched dragon melee addresses its head part and confirms damage separately',async()=>{
  const c=new OMConnect(),packets=[];
  c.state={...c.state,status:'ready',position:{x:.5,y:64,z:.5},velocity:{x:0,y:0,z:0},onGround:true,health:20,food:20,dimension:'minecraft:the_end'};
  c.world.blockAt=flat;
  const raw={itemCount:1,itemId:c.registry.itemsByName.netherite_sword.id,addedComponentCount:0,removedComponentCount:0,components:[],removeComponents:[]};
  c.inventory.updateSlot({windowId:0,slot:36,stateId:1,item:raw});
  const dragon={id:'42',name:'ender_dragon',kind:'entity',position:{x:-5,y:65,z:0},yaw:90,pitch:0,metadata:{phase:5,health:20}};
  c.entities.set(42,dragon);c.client={state:'play',end(){}};
  c.write=(name,packet)=>{packets.push({name,packet});if(name==='use_entity'){dragon.metadata.health=10;c.endgame.ownDragonHits=1;c.emit('entity',dragon);}};
  const result=await c.execute({skill:'attackDragon',args:{entityId:'42',critical:false}});
  assert.equal(result.damageConfirmed,true);assert.equal(result.criticalAttempted,false);assert.equal(result.headId,43);
  assert.equal(packets.filter(p=>p.name==='use_entity').length,1);
  await c.close();
});
test('crystal removal is reported separately from confirmation of our arrow',async()=>{
  const {c,packets}=armed('bow');
  Object.assign(c.entities.get(42),{name:'end_crystal'});
  c.on('sent',e=>{if(e.name==='block_dig'&&e.packet.status===5)setTimeout(()=>{c.entities.delete(42);(c.endgame.crystals??=[]).push({entityId:'42',at:Date.now()});},25);});
  const result=await c.execute({skill:'shoot',args:{entityId:'42'}});
  assert.equal(result.crystalDestroyedServerConfirmed,true);
  assert.equal(result.shotServerConfirmed,false);
  assert.equal(result.hitConfirmed,false);
  assert.equal(packets.filter(e=>e.name==='block_dig'&&e.packet.status===5).length,1);
  await c.close();
});
test('ranged PvP needs permission and unknown terrain prevents charging', async () => {
  const { c, packets } = armed('bow'); c.entities.get(42).kind = 'player';
  await assert.rejects(c.execute({ skill: 'shoot', args: { entityId: '42' } }), /PvP/);
  c.entities.get(42).kind = 'entity'; c.world.blockAt = () => null;
  await assert.rejects(c.execute({ skill: 'shoot', args: { entityId: '42' } }), /trajectory/i);
  assert.equal(packets.some(e => e.name === 'use_item'), false); await c.close();
});
