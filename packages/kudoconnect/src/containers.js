import { readSlot } from './inventory.js';
export const isStorageBlock = name => /^(chest|trapped_chest|barrel|(?:[a-z_]+_)?shulker_box)$/.test((name || '').replace(/^minecraft:/,''));
export function storageIdentity(world, position) {
  const block = world.blockAt(position), name = block?.name?.replace(/^minecraft:/,'');
  if (!isStorageBlock(name)) return null;
  const positions = [{x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)}], props = block.getProperties?.() || {};
  if (['chest','trapped_chest'].includes(name) && ['left','right'].includes(props.type)) {
    const clockwise = {north:[1,0],east:[0,1],south:[-1,0],west:[0,-1]}[props.facing];
    if (clockwise) {
      const sign = props.type === 'left' ? 1 : -1, p = {...positions[0],x:positions[0].x+clockwise[0]*sign,z:positions[0].z+clockwise[1]*sign};
      const other = world.blockAt(p), otherProps = other?.getProperties?.() || {};
      if (other?.name === block.name && otherProps.facing === props.facing && otherProps.type === (props.type === 'left' ? 'right' : 'left')) positions.push(p);
    }
  }
  const key = positions.map(p=>`${p.x},${p.y},${p.z}`).sort().join('|');
  return {key,positions,kind:positions.length===2?'double_chest':name.endsWith('shulker_box')?'shulker_box':name};
}
export async function findStorages(client, { radius = 64, count = 32, signal } = {}) {
  if (!client.state.position || !Number.isInteger(count) || count < 1 || count > 128) throw new Error('findStorages: нужна позиция клиента и count 1–128.');
  const found = await client.world.findBlocks({classes:['#containers'],position:client.state.position,radius,count:Math.min(512,count*2),signal});
  const storages = new Map();
  for (const b of found.blocks) {
    const identity = storageIdentity(client.world,b.position); if (!identity || storages.has(identity.key)) continue;
    storages.set(identity.key,{...b,...identity});
  }
  return { visited:found.visited,truncated:found.truncated,revision:found.revision,storages:[...storages.values()].slice(0,count) };
}
/** Vanilla generic 9×N storage windows. No optimistic inventory mutation. */
export class KudoContainers {
  constructor(inventory, registry) { this.inventory = inventory; this.registry = registry; this.current = null; this.revision = 0; this.observations = new Map(); }
  open(packet) {
    // Java 1.21.1: shulker_box menu 20 also has 27 storage + 36 player slots.
    const rows = packet.inventoryType === 20 ? 3 : Number.isInteger(packet.inventoryType) && packet.inventoryType >= 0 && packet.inventoryType <= 5 ? packet.inventoryType + 1 : null;
    const workstations = {12:{slots:10,kind:'crafting'},14:{slots:3,kind:'furnace'},10:{slots:3,kind:'blast_furnace'},22:{slots:3,kind:'smoker'}};
    const station = workstations[packet.inventoryType];
    this.current = { id: packet.windowId, type: packet.inventoryType, kind:station?.kind || (rows?'storage':'unsupported'), storageSlots: station?.slots ?? (rows ? rows * 9 : null), slots: [], stateId: null, ready: false }; this.revision++;
  }
  acceptState(next) {
    const previous = this.current?.stateId;
    if (!Number.isInteger(next) || next < 0 || next > 32767 || previous !== null && ((next - previous + 32768) % 32768) > 16384) return false;
    this.current.stateId = next; return true;
  }
  updateWindow(packet) {
    const w = this.current; if (!w || packet.windowId !== w.id || !w.storageSlots || packet.items.length !== w.storageSlots + 36 || !this.acceptState(packet.stateId)) return false;
    w.slots = packet.items.map((s,i) => readSlot(s, this.registry, i));
    this.inventory.cursor = readSlot(packet.carriedItem, this.registry);
    for (let i = 0; i < 36; i++) { const item = w.slots[w.storageSlots + i]; this.inventory.slots[9 + i] = item ? { ...item, slot: 9 + i } : null; }
    w.ready = true; this.inventory.revision++; this.revision++; return true;
  }
  updateSlot(packet) {
    const w = this.current;
    if (!w || !w.ready || packet.windowId !== w.id || packet.slot < 0 || packet.slot >= w.slots.length || !this.acceptState(packet.stateId)) return false;
    w.slots[packet.slot] = readSlot(packet.item, this.registry, packet.slot);
    if (packet.slot >= w.storageSlots) { const index = 9 + packet.slot - w.storageSlots, item = w.slots[packet.slot]; this.inventory.slots[index] = item ? { ...item, slot: index } : null; this.inventory.revision++; }
    this.revision++; return true;
  }
  close(windowId) { if (this.current?.id === windowId) { this.current = null; this.revision++; } }
  contents() { const w = this.current; return w?.ready ? w.slots.slice(0, w.storageSlots).filter(Boolean).map(i => ({ ...i, raw: structuredClone(i.raw) })) : []; }
  capacity(item) {
    const max = this.registry.itemsByName[item.name]?.stackSize || 64;
    return this.inventory.slots.slice(9,45).reduce((sum, slot) => sum + (!slot ? max : slot.name === item.name && JSON.stringify(slot.raw.components || []) === JSON.stringify(item.raw.components || []) && JSON.stringify(slot.raw.removeComponents || []) === JSON.stringify(item.raw.removeComponents || []) ? Math.max(0, max - slot.count) : 0), 0);
  }
  remember(dimension, position, identity) {
    const key = `${dimension}:${identity?.key || `${position.x},${position.y},${position.z}`}`;
    this.observations.set(key, { dimension, position: { ...position }, ...(identity || {}), observedAt: Date.now(), contents: this.contents().map(i => ({ item: i.item, count: i.count })) });
    if (this.observations.size > 128) this.observations.delete(this.observations.keys().next().value);
  }
}
