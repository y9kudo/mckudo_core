import test from 'node:test';
import assert from 'node:assert/strict';
import { KudoConnect } from '../src/client.js';
import { craftingRecipes, chooseCraftingRecipe, craft, ensureStation, smelt, smeltingRecipe } from '../src/crafting.js';

const registry = new KudoConnect().registry;
const empty = () => ({ itemCount: 0 });
const raw = (name, count = 1) => ({ itemCount: count, itemId: registry.itemsByName[name].id, components: [], removeComponents: [] });
const nameOf = value => value?.itemCount ? registry.items[value.itemId].name : null;
const signal = () => new AbortController().signal;

function fixture(initial = {}, { station, ack = true, resultOnly = false, rejectResult = false } = {}) {
  const c = new KudoConnect(), packets = [], invoked = [], blocks = new Map();
  c.state = { ...c.state, status: 'ready', health: 20, food: 20, position: { x: .5, y: 1, z: .5 }, onGround: true };
  c.lookAt = () => {}; c.waitForLook = async () => {};
  let inventory = Array.from({ length: 46 }, empty), active = null, cursor = empty(), revision = 0, burnTimer;
  const add = (list, name, count, start = 9, end = 45) => {
    let target = list.findIndex((v, i) => i >= start && i < end && nameOf(v) === name && v.itemCount + count <= 64);
    if (target < 0) target = list.findIndex((v, i) => i >= start && i < end && !v.itemCount);
    assert.notEqual(target, -1); list[target] = raw(name, (list[target].itemCount || 0) + count);
  };
  for (const [name, count] of Object.entries(initial)) add(inventory, name, count);
  const posKey = p => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  if (station) blocks.set('2,1,0', station);
  c.world.blockAt = p => { const name = blocks.get(posKey(p)) || (p.y < 1 ? 'stone' : 'air'); return { name, boundingBox: name === 'air' ? 'empty' : 'block', shapes: name === 'air' ? [] : [[0, 0, 0, 1, 1, 1]] }; };
  c.world.findBlocks = async ({ names }) => ({ blocks: [...blocks].filter(([, n]) => names.includes(n)).map(([key, name]) => { const [x,y,z] = key.split(',').map(Number); return { name: 'minecraft:' + name, position: {x,y,z} }; }) });
  const sync = () => {
    revision++;
    if (active) {
      c.containers.updateWindow({ windowId: 1, stateId: revision, items: structuredClone(active.slots), carriedItem: structuredClone(cursor) });
      inventory.splice(9, 36, ...structuredClone(active.slots.slice(active.top)));
    } else c.inventory.updateWindow({ windowId: 0, stateId: revision, items: structuredClone(inventory), carriedItem: structuredClone(cursor) });
    c.emit('inventory'); c.emit('container');
  };
  const recompute = () => {
    const slots = active?.slots || inventory;
    if (active?.station === 'furnace') {
      if (!burnTimer && nameOf(slots[0]) === 'raw_iron' && nameOf(slots[1]) === 'coal') burnTimer = setTimeout(() => {
        const amount = slots[0].itemCount; slots[0] = empty(); slots[1].itemCount--; slots[2] = raw('iron_ingot', amount); sync();
      }, 30);
      return;
    }
    const width = active ? 3 : 2, grid = slots.slice(1, active ? 10 : 5).map(nameOf), isPlank = n => n?.endsWith('_planks');
    slots[0] = empty();
    if (rejectResult) return;
    if (grid[0] === 'birch_log' && grid.slice(1).every(n => !n)) slots[0] = raw('birch_planks', 4);
    if (width === 2 && grid.every(isPlank)) slots[0] = raw('crafting_table');
    if (width === 2 && isPlank(grid[0]) && isPlank(grid[2]) && !grid[1] && !grid[3]) slots[0] = raw('stick', 4);
    if (width === 3 && grid.slice(0, 3).every(isPlank) && grid[4] === 'stick' && grid[7] === 'stick' && [3,5,6,8].every(i => !grid[i])) slots[0] = raw('wooden_pickaxe');
    if (width === 3 && !grid[4] && grid.filter(Boolean).length === 8 && grid.filter(Boolean).every(n => n === 'cobblestone')) slots[0] = raw('furnace');
  };
  c.client = { state: 'play', end() {}, write(name, p) {
    packets.push({ name, p: structuredClone(p) });
    if (name === 'block_place') {
      const station = blocks.get(posKey(p.location)), top = station === 'crafting_table' ? 10 : 3;
      assert.ok(station); active = { station, top, slots: [...Array.from({length:top}, empty), ...structuredClone(inventory.slice(9,45))] };
      c.containers.open({ windowId:1, inventoryType: station === 'crafting_table' ? 12 : 14 }); sync();
    }
    if (name === 'close_window') {
      if (active) { inventory.splice(9,36,...structuredClone(active.slots.slice(active.top))); if(active.station === 'crafting_table') for(const s of active.slots.slice(1,10)) if(s.itemCount)add(inventory,nameOf(s),s.itemCount); }
      else for(let i=1;i<=4;i++) { if(inventory[i].itemCount)add(inventory,nameOf(inventory[i]),inventory[i].itemCount); inventory[i]=empty(); }
      if(cursor.itemCount)add(inventory,nameOf(cursor),cursor.itemCount);
      cursor=empty(); active=null;
    }
    if (name === 'window_click' && ack) {
      assert.equal(p.stateId,-1); const slots = active?.slots || inventory, top = active?.top || 9;
      if (p.slot < 0) { sync(); return; }
      const source = slots[p.slot];
      if (p.mode === 1) {
        if (!resultOnly) { slots[p.slot]=empty(); if(p.slot===0 && active?.station!=='furnace')for(let i=1;i<(active?10:5);i++)slots[i]=empty(); }
        add(slots,nameOf(source),source.itemCount,top,top+36);
      } else if (!cursor.itemCount) { cursor=structuredClone(source); slots[p.slot]=empty(); }
      else if(p.mouseButton===1) { slots[p.slot]=raw(nameOf(cursor),(source.itemCount||0)+1); cursor.itemCount--; }
      else { slots[p.slot]=structuredClone(cursor); cursor=empty(); }
      recompute(); sync();
    }
  }};
  const runtime = {
    approach: async () => {},
    run: async (_c, action) => {
      invoked.push(action);
      if(action.skill==='gather') { add(inventory, action.args.block==='#logs'?'birch_log':'cobblestone',1); sync(); return {ok:true}; }
      if(action.skill==='place') {
        const i=inventory.findIndex(s=>nameOf(s)===action.args.block); assert.notEqual(i,-1); inventory[i].itemCount--; blocks.set(posKey(action.args),action.args.block); sync(); return {ok:true};
      }
      throw new Error(`Unexpected ${action.skill}`);
    }
  };
  sync(); return { c, runtime, packets, invoked, dispose:()=>clearTimeout(burnTimer) };
}

test('registry recipes resolve mixed vanilla planks while preserving species recipes and batch outputs', () => {
  const mixed=chooseCraftingRecipe(registry,'crafting_table',{'minecraft:oak_planks':2,'minecraft:birch_planks':2});
  assert.equal(mixed.cells.length,4); assert.equal(mixed.cells.filter(c=>c.item==='birch_planks').length,2);
  assert.equal(chooseCraftingRecipe(registry,'oak_slab',{birch_planks:3}),null);
  assert.equal(chooseCraftingRecipe(registry,'stick',{oak_planks:1}),null);
  assert.equal(chooseCraftingRecipe(registry,'stick',{oak_planks:2}).count,4);
  assert.equal(craftingRecipes(registry,'diamond_chestplate')[0].table,true);
  assert.deepEqual(craftingRecipes(registry,'cake'),[]);
});

test('inventory crafting only reports server-confirmed inputs, cursor and new result items', async () => {
  const {c,runtime,packets}=fixture({birch_log:2});
  const result=await craft(c,{item:'birch_planks',count:5},signal(),runtime);
  assert.equal(result.produced,8);assert.equal(result.times,2);assert.equal(c.inventory.count('birch_log'),0);assert.equal(c.inventory.count('birch_planks'),8);
  assert.equal(c.inventory.cursor,null);assert.equal(c.inventory.slots.slice(0,5).some(Boolean),false);
  assert.ok(packets.every(p=>p.name!=='window_click'||p.p.changedSlots.length===0));
});

test('3x3 crafting opens the workbench and closes and resyncs after collecting the result', async () => {
  const {c,runtime,packets}=fixture({birch_planks:3,stick:2},{station:'crafting_table'});
  const result=await craft(c,{item:'wooden_pickaxe',count:1},signal(),runtime);
  assert.equal(result.produced,1);assert.equal(c.inventory.count('wooden_pickaxe'),1);assert.equal(c.containers.current,null);
  assert.equal(c.inventory.cursor,null);assert.equal(c.containerRequest,false);
  assert.ok(packets.some(p=>p.name==='block_place'));assert.ok(packets.some(p=>p.name==='close_window'&&p.p.windowId===1));
});

test('unacknowledged clicks cannot invent a crafted item and cancellation closes the inventory', async () => {
  const {c,runtime,packets}=fixture({birch_log:1},{ack:false});
  await assert.rejects(craft(c,{item:'birch_planks'},AbortSignal.timeout(30),runtime));
  assert.equal(c.inventory.count('birch_planks'),0);assert.equal(c.inventory.count('birch_log'),1);
  assert.equal(packets.filter(p=>p.name==='window_click').length,1);
});

test('output growth alone cannot acknowledge a result click while recipe inputs remain', async () => {
  const {c,runtime}=fixture({birch_log:1},{resultOnly:true});
  await assert.rejects(craft(c,{item:'birch_planks'},AbortSignal.timeout(40),runtime));
  assert.equal(c.inventory.count('birch_planks'),4);
});

test('station provisioning from an empty inventory follows logs, planks, table, pickaxe and furnace', async () => {
  const {c,runtime,invoked}=fixture();
  const table=await ensureStation(c,{station:'crafting_table'},signal(),runtime);
  assert.equal(table.created,true);assert.ok(invoked.some(a=>a.args.block==='#logs'));
  const furnace=await ensureStation(c,{station:'furnace'},signal(),runtime);
  assert.equal(furnace.created,true);assert.equal(c.inventory.count('wooden_pickaxe'),1);
  assert.equal(invoked.filter(a=>a.skill==='gather'&&a.args.item==='cobblestone').length,8);
});

test('furnace consumes confirmed raw input and fuel and withdraws authoritative output', async () => {
  const {c,runtime,dispose}=fixture({raw_iron:3,coal:1},{station:'furnace'});
  try {
    const result=await smelt(c,{item:'iron_ingot',count:3},signal(),runtime);
    assert.equal(result.produced,3);assert.equal(c.inventory.count('iron_ingot'),3);assert.equal(c.inventory.count('raw_iron'),0);
    assert.equal(c.containers.current,null);assert.equal(c.inventory.cursor,null);
  } finally {dispose();}
});

test('smelting refuses unverified custom inputs and insufficient fuel before sending packets', async () => {
  const {c,runtime,packets}=fixture({raw_iron:3,stick:1},{station:'furnace'});
  await assert.rejects(smelt(c,{item:'iron_ingot',count:3},signal(),runtime),/топлива/);
  await assert.rejects(smelt(c,{item:'iron_ingot',count:1,input:'diamond'},signal(),runtime),/сырья/);
  assert.equal(packets.length,0);assert.equal(smeltingRecipe(registry,'diamond'),null);
});
