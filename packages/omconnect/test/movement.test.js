import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import blockLoader from 'prismarine-block';
import { OMConnect } from '../src/client.js';
import { stepPhysics } from '../src/physics.js';
import { planRoute } from '../src/navigation.js';
import { SmoothLook, rotateToward, bridgeMaterials, safeCorridor, travelControl, combatControl, executeNavigate,personalSpaceControl } from '../src/movement.js';

const air = { name: 'air', shapes: [], boundingBox: 'empty' }, stone = { name: 'stone', shapes: [[0, 0, 0, 1, 1, 1]], boundingBox: 'block' };
const flat = p => Math.floor(p.y) < 1 ? stone : air;
const registry = minecraftData('1.21.1'), Block = blockLoader(registry);
const initial = () => ({ position: { x: .5, y: 1, z: .5 }, velocity: { x: 0, y: -.0784, z: 0 }, yaw: -90, pitch: 0, onGround: true, food: 20, health: 20, status: 'ready' });

test('movement anticipates a crossing player and ignores non-colliding spectators',()=>{
  const control={x:1,z:0,sprint:true,jump:false},crossing={id:8,kind:'player',position:{x:1.5,y:1,z:2.3},velocity:{x:0,y:0,z:-.4}};
  const avoid=personalSpaceControl(initial(),control,[crossing],flat,1);assert.ok(avoid.x<.99||Math.abs(avoid.z)>.1);assert.equal(avoid.sprint,false);
  assert.deepEqual(personalSpaceControl(initial(),control,[{...crossing,gameMode:3}],flat,1),control);
  const cliff=p=>p.z<1?flat(p):null;const retreat=personalSpaceControl(initial(),control,[crossing],cliff,1);assert.ok(!retreat.x&&!retreat.z||safeCorridor(initial().position,retreat,1.2,cliff));
});

test('personal-space braking checks only the remaining segment after a drop beside a wall',()=>{
  const terrain=p=>p.y<(p.x<=0?2:1)?stone:air,state={...initial(),position:{x:1.75,y:1,z:.5}};
  const control={x:-.375,z:0,sprint:false,jump:false},peer={id:'8',kind:'player',position:{x:.5,y:2,z:2.5}};
  const braking=personalSpaceControl(state,control,[peer],terrain,1,{lookAhead:.25});
  assert.ok(braking.x<0);assert.equal(braking.z,0);
  assert.equal(safeCorridor(state.position,{x:-1,z:0},.25,terrain),true);
  const gap=p=>p.x>=2?null:flat(p);
  assert.equal(safeCorridor({x:1.65,y:1,z:.5},{x:1,z:0},.1,gap),false,'the final footprint is checked even between sample intervals');
});

test('smooth look wraps the shortest way, caps angular speed, and cancels the abandoned target', () => {
  const next = rotateToward({ yaw: 179, pitch: 0 }, { yaw: -179, pitch: 70 });
  assert.ok(next.yaw > 179 || next.yaw < -179); assert.ok(next.pitch > 0 && next.pitch <= 27);
  const state = initial(), look = new SmoothLook(), abort = new AbortController();
  look.set(state, { x: 0, y: 3, z: 10 }, { signal: abort.signal });
  look.tick(state); const afterOne = { yaw: state.yaw, pitch: state.pitch };
  assert.ok(state.yaw > -90 && state.yaw < 0);
  abort.abort(); look.tick(state);
  assert.deepEqual({ yaw: state.yaw, pitch: state.pitch }, afterOne); assert.equal(look.target, null);
  look.set(state, { x: -10, y: 2.62, z: .5 });
  for (let i = 0; i < 30; i++) look.tick(state);
  assert.equal(look.target, null); assert.equal(state.yaw, 90);
});

test('waitForLook works without a physics loop and never changes the position', async () => {
  const c = new OMConnect(), packets = [];
  Object.assign(c.state, initial()); c.client = { state: 'play', write: (name, data) => packets.push([name, data]) };
  const before = { ...c.state.position };
  c.lookAt({ x: .5, y: 2.62, z: 10 });
  assert.equal(c.state.yaw, -90);
  await c.waitForLook();
  assert.ok(Math.abs(c.state.yaw)<.001); assert.deepEqual(c.state.position, before);
  assert.ok(packets.length > 2); assert.ok(packets.every(([name]) => name === 'position_look'));
});

test('sprint physics uses vanilla acceleration and facing jump impulse; hunger and shielding disable it', () => {
  let walk = initial(), sprint = initial();
  for (let i = 0; i < 40; i++) { walk = stepPhysics(walk, { x: 1 }, flat); sprint = stepPhysics(sprint, { x: 1, sprint: true }, flat); }
  const ratio = (sprint.position.x - .5) / (walk.position.x - .5);
  assert.ok(Math.abs(ratio - 1.3) < .001);
  const jump = stepPhysics(initial(), { x: 1, sprint: true, jump: true }, flat);
  assert.ok(Math.abs(jump.position.x - .5 - (.13 * .98 + .2)) < .00001);
  assert.ok(Math.abs(jump.position.y - 1 - Math.fround(.42)) < .00001);
  assert.equal(stepPhysics({ ...initial(), food: 6 }, { x: 1, sprint: true }, flat).sprinting, false);
  assert.equal(stepPhysics(initial(), { x: 1, sprint: true, usingItem: true }, flat).sprinting, false);
});

test('sprint-jump requires a distant flat known landing corridor and enough headroom', () => {
  const state = initial(), target = { x: 20.5, y: 1, z: .5 };
  assert.equal(travelControl(state, target, flat).jump, true);
  assert.equal(travelControl(state, { ...target, x: 4 }, flat).jump, false);
  assert.equal(travelControl(state, target, p => p.y === 3 ? stone : flat(p)).jump, false);
  const unknown = p => p.x >= 3 ? null : flat(p);
  assert.equal(travelControl(state, target, unknown).jump, false);
  assert.equal(safeCorridor(state.position, { x: 1, z: 0 }, 5, unknown), false);
  assert.equal(travelControl({ ...state, food: 5 }, target, flat).sprint, false);
  assert.equal(travelControl(state, target, flat, { guarding: true }).sprint, false);
  assert.equal(travelControl({ ...state, yaw: 90 }, target, flat).sprint, false);
  const gap = p => p.y === 0 && p.x === 3 ? air : flat(p);
  assert.equal(travelControl(state, target, gap).jump, false);
});

test('material selection accepts varied ordinary blocks, preserves valuables, and supports custom valuations', () => {
  const names = ['sand', 'gravel', 'red_concrete_powder', 'diamond_block', 'raw_iron_block', 'chest', 'furnace', 'crafting_table', 'oak_slab', 'magma_block', 'cobblestone', 'dirt', 'oak_planks', 'red_concrete', 'white_wool'];
  const items = names.map((name, slot) => ({ name, slot, count: 8 }));
  const materials = bridgeMaterials(registry, items, { blockAtState: id => Block.fromStateId(id, 0) });
  assert.deepEqual(new Set(materials.map(b => b.name)), new Set(['cobblestone', 'dirt', 'oak_planks', 'red_concrete', 'white_wool']));
  assert.equal(materials[0].value, 1);
  assert.equal(bridgeMaterials(registry, items, { blockAtState: id => Block.fromStateId(id, 0), itemValue: name => name === 'white_wool' ? 0 : 10 })[0].name, 'white_wool');
  assert.equal(bridgeMaterials(registry, [{ name: 'dirt', count: 2 }], { reserve: 2 }).length, 0);
});

test('combat moves around blocked strafes but refuses unknown edges and never jumps blindly', () => {
  const state = initial(), target = { x: 10, y: 1, z: .5 };
  assert.equal(combatControl(state, target, 'approach', flat).sprint, true);
  assert.equal(combatControl(state, target, 'retreat', flat).sprint, false);
  assert.equal(combatControl(state, target, 'strafe', flat).jump, false);
  assert.deepEqual(combatControl(state, target, 'approach', () => null), { x: 0, z: 0, jump: false, sprint: false });
  const oneSide = p => p.z < 0 ? null : flat(p);
  const strafe = combatControl(state, target, 'strafe', oneSide);
  assert.ok(strafe.z > 0);
});

function simulatedClient(getBlock, items = []) {
  const c = new OMConnect(), samples = [];
  Object.assign(c.state, initial());
  c.world = { blockAt: p => getBlock({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }), Block };
  c.inventory.items = () => items;
  c.client = { state: 'play', write() {} };
  c.timer = setInterval(() => {
    c.state = stepPhysics(c.state, c.control, c.world.blockAt); c.tickLook(); c.emit('physics');
    samples.push({ position: { ...c.state.position }, sprinting: c.state.sprinting, jumping: c.control.jump });
  }, 5);
  return { c, samples, cleanup: () => clearInterval(c.timer) };
}

test('navigation runs and jumps a long straight route, then stops within the destination cell', async () => {
  const { c, samples, cleanup } = simulatedClient(flat);
  try {
    const result = await executeNavigate(c, { x: 20, y: 1, z: 0, range: 0 }, new AbortController().signal);
    assert.equal(result.ok, true); assert.ok(Math.abs(c.state.position.x - 20.5) < .4);
    assert.ok(samples.some(s => s.sprinting)); assert.ok(samples.some(s => s.jumping));
    assert.ok(samples.every(s => s.position.y < 2.5)); assert.equal(c.control.sprint, false);
  } finally { cleanup(); }
});

test('one-block drop works near another player instead of being rejected as a flat corridor',async()=>{
  const terrain=p=>p.y<(p.x<=0?2:1)?stone:air;
  const {c,samples,cleanup}=simulatedClient(terrain);c.state.position.y=2;
  c.entities.set(8,{id:'8',kind:'player',position:{x:.5,y:2,z:2.5}});
  try{
    const result=await executeNavigate(c,{x:2,y:1,z:0,range:0,bridge:false},AbortSignal.timeout(5000));
    assert.equal(result.ok,true);assert.equal(result.estimatedFallDamage,0);assert.equal(c.state.position.y,1);
    assert.ok(samples.some(s=>s.position.y>1&&s.position.y<2));
  }finally{cleanup();}
});

test('one-block ascent near a spectator keeps its verified jump direction',async()=>{
  const terrain=p=>p.y<(p.x<=0?1:2)?stone:air;
  const {c,samples,cleanup}=simulatedClient(terrain);
  c.entities.set(8,{id:'8',kind:'player',position:{x:.5,y:1,z:2.5}});
  try{
    const result=await executeNavigate(c,{x:2,y:2,z:0,range:0,bridge:false},AbortSignal.timeout(5000));
    assert.equal(result.ok,true);assert.equal(c.state.position.y,2);assert.ok(samples.some(s=>s.jumping));
  }finally{cleanup();}
});

test('navigation builds a mixed-material bridge only after each placement is confirmed', async () => {
  const placed = new Map(), key = p => `${p.x},${p.y},${p.z}`, calls = [];
  const terrain = p => placed.get(key(p)) || (p.z !== 0 ? stone : p.y === 0 && (p.x <= 0 || p.x >= 3) ? stone : air);
  const items = [{ name: 'cobblestone', count: 1 }, { name: 'oak_planks', count: 1 }];
  const { c, samples, cleanup } = simulatedClient(terrain, items);
  try {
    const result = await executeNavigate(c, { x: 3, y: 1, z: 0, range: 0 }, new AbortController().signal, {
      place: async p => {
        assert.ok(c.state.position.x < p.x); assert.ok(c.state.onGround);
        calls.push(p.block); const item = items.find(i => i.name === p.block.replace('minecraft:', '')); item.count--;
        placed.set(key(p), { ...stone, name: item.name });
      }
    });
    assert.equal(result.bridgeUsed, 2); assert.deepEqual(calls, ['minecraft:cobblestone', 'minecraft:oak_planks']);
    assert.ok(samples.every(s => s.position.y >= 1)); assert.ok(samples.every(s => !s.jumping));
  } finally { cleanup(); }
});

test('sneaking holds both straight and diagonal motion at a 100-block cliff, without holding an airborne player',()=>{
  const ledge=p=>p.y===100&&p.x===0&&p.z===0?stone:air;
  for(const direction of [{x:1,z:0},{x:1,z:1},{x:-1,z:1}]){
    let state={...initial(),position:{x:.5,y:101,z:.5}};
    for(let i=0;i<160;i++)state=stepPhysics(state,{...direction,sneak:true,sprint:true},ledge);
    assert.equal(state.position.y,101);assert.ok(state.position.x>-.3&&state.position.x<1.3);assert.ok(state.position.z<1.3);assert.equal(state.sprinting,false);
  }
  const fall=stepPhysics({...initial(),position:{x:2,y:100,z:0},onGround:false,velocity:{x:.1,y:-.5,z:0}},{sneak:true},ledge);
  assert.ok(fall.position.y<100,'crouching does not grant flight');
});

test('high bridge crouches, confirms inventory consumption and releases the server crouch state',async()=>{
  const placed=new Map(),key=p=>`${p.x},${p.y},${p.z}`,items=[{name:'cobblestone',count:3}];
  const terrain=p=>placed.get(key(p))||(p.z!==0?stone:p.y===100&&(p.x<=0||p.x>=4)?stone:air);
  const {c,samples,cleanup}=simulatedClient(terrain,items),packets=[];c.state.position.y=101;c.state.entityId=1;c.client.write=(name,data)=>packets.push({name,data});
  try{
    const result=await executeNavigate(c,{x:4,y:101,z:0,range:0},AbortSignal.timeout(5000),{place:async p=>{
      assert.equal(c.control.sneak,true);assert.equal(c.control.sprint,false);assert.equal(c.state.onGround,true);
      items[0].count--;placed.set(key(p),stone);c.emit('inventory');
    }});
    assert.equal(result.bridgeUsed,3);assert.equal(items[0].count,0);assert.ok(samples.every(s=>s.position.y>=101));
    const actions=packets.filter(p=>p.name==='entity_action').map(p=>p.data.actionId);
    assert.equal(actions[0],'start_sneaking');assert.equal(actions.at(-1),'stop_sneaking');assert.equal(c.control.sneak,false);
  }finally{cleanup();}
});

test('bridge cannot advance on a block update alone and cancellation releases crouching',async()=>{
  const placed=new Map(),key=p=>`${p.x},${p.y},${p.z}`,items=[{name:'cobblestone',count:1}];
  const terrain=p=>placed.get(key(p))||(p.z!==0?stone:p.y===100&&(p.x<=0||p.x>=2)?stone:air);
  const {c,cleanup}=simulatedClient(terrain,items);c.state.position.y=101;
  const abort=new AbortController();
  try{
    const run=executeNavigate(c,{x:2,y:101,z:0,range:0},abort.signal,{place:async p=>{placed.set(key(p),stone);setTimeout(()=>abort.abort(new Error('cancel bridge confirmation')),30);}});
    await assert.rejects(run,/cancel bridge confirmation/);assert.ok(c.state.position.x<1);assert.equal(c.control.sneak,false);
  }finally{cleanup();}
});

test('unknown space never becomes a bridge and missing placement confirmation stops at the edge', async () => {
  assert.equal(planRoute({ start: { x: 0, y: 1, z: 0 }, goal: { x: 3, y: 1, z: 0 }, getBlock: p => p.x > 0 ? null : flat(p), bridgeBudget: 32, maxNodes: 100 }).status, 'blocked');
  const terrain = p => p.z !== 0 ? stone : p.y === 0 && (p.x <= 0 || p.x >= 2) ? stone : air;
  const { c, cleanup } = simulatedClient(terrain, [{ name: 'dirt', count: 4 }]);
  try {
    await assert.rejects(executeNavigate(c, { x: 2, y: 1, z: 0, range: 0 }, new AbortController().signal, { place: async () => {} }), /did not confirm/);
    assert.equal(c.state.position.x, .5); assert.equal(c.control.sprint, false);
  } finally { cleanup(); }
});

test('excavation opens staircase headroom to escape a mine without digging either support',async()=>{
  const removed=new Set(),key=p=>`${p.x},${p.y},${p.z}`,dug=[];
  const rock=Block.fromStateId(registry.blocksByName.stone.defaultState,0);
  const terrain=p=>removed.has(key(p))?air:p.z!==0||p.y<(p.x<=0?1:p.x<=1?2:3)||p.x===0&&p.y===3||p.x===1&&p.y===3?rock:air;
  const options={start:{x:0,y:1,z:0},goal:{x:2,y:3,z:0},getBlock:terrain,maxNodes:128};
  assert.equal(planRoute(options).status,'blocked');
  const planned=planRoute({...options,canDig:b=>b.name==='stone'});assert.equal(planned.status,'planned');assert.ok(planned.steps.some(s=>s.kind==='dig'));
  const {c,cleanup}=simulatedClient(terrain,[{name:'wooden_pickaxe',type:registry.itemsByName.wooden_pickaxe.id,count:1,slot:36}]);
  try {
    const result=await executeNavigate(c,{x:2,y:3,z:0,range:0,bridge:false,excavate:true},AbortSignal.timeout(5000),{
      dig:async p=>{const foot=c.state.position;assert.ok(p.x!==Math.floor(foot.x)||p.z!==Math.floor(foot.z)||p.y>=Math.floor(foot.y));dug.push(key(p));removed.add(key(p));}
    });
    assert.equal(result.ok,true);assert.equal(c.state.position.y,3);assert.ok(dug.includes('0,3,0'));assert.ok(dug.includes('1,3,0'));
  }finally{cleanup();}
});

test('staircase excavation rejects a falling ceiling, adjacent liquid and unknown neighbors',()=>{
  const rock={...stone,diggable:true,hardness:1.5};
  const terrain=p=>p.z!==0||p.y<(p.x<=0?1:2)||p.x===0&&p.y===3?rock:air;
  const options={start:{x:0,y:1,z:0},goal:{x:1,y:2,z:0},maxNodes:128,canDig:(b,p)=>b.name==='stone'&&p.x===0&&p.y===3&&p.z===0};
  assert.equal(planRoute({...options,getBlock:terrain}).status,'planned');
  for(const danger of [null,{...rock,name:'sand'},{...air,name:'lava'}]) {
    const getBlock=p=>p.x===0&&p.z===0&&p.y===4?danger:terrain(p);
    assert.equal(planRoute({...options,getBlock}).status,'blocked');
  }
});

test('a route never reuses a mined block as future support and preserves planned bridge support',()=>{
  const rock={...stone,diggable:true,hardness:1.5};
  const terrain=p=>p.z!==0||p.y<(p.x<=0?1:2)||p.x===0&&p.y===3?rock:air;
  const options={start:{x:0,y:1,z:0},goal:{x:1,y:2,z:0},maxNodes:256,canDig:(b,p)=>b.name==='stone'&&p.x===1&&p.y===1&&p.z===0,getBlock:p=>p.x===0&&p.z===0&&p.y===4?{...rock,name:'sand'}:terrain(p)};
  assert.equal(planRoute(options).status,'blocked','mined terrain is no longer a valid support');
  const plan=planRoute({...options,bridgeBudget:1});
  const edits=new Map(),key=p=>`${p.x},${p.y},${p.z}`,at=p=>edits.get(key(p))||terrain(p);
  assert.equal(plan.status,'planned');
  assert.ok(plan.steps.some(s=>s.kind==='bridge'&&s.position.x===1&&s.position.y===1&&s.position.z===0));
  for(const step of plan.steps) {
    if(step.kind==='dig')edits.set(key(step.position),air);
    else if(step.kind==='bridge')edits.set(key(step.position),rock);
    else {assert.equal(at(step.position).name,'air');assert.equal(at({...step.position,y:step.position.y-1}).boundingBox,'block','every executed move must retain its support');}
  }
});
