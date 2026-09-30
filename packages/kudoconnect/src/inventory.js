export function readSlot(raw, registry, slot = -1) {
  if (!raw || !raw.itemCount) return null;
  const item = registry.items[raw.itemId]; if (!item) throw new Error(`Неизвестный item ID ${raw.itemId}.`);
  return { name: item.name, item: 'minecraft:' + item.name, type: raw.itemId, count: raw.itemCount, slot, raw: structuredClone(raw) };
}
export class KudoInventory {
  constructor(registry) { this.registry = registry; this.slots = Array(46).fill(null); this.stateId = 0; this.revision = 0; this.cursor = null; this.selected = 0; }
  updateWindow(packet) {
    if (packet.windowId !== 0) return false;
    this.slots = packet.items.map((s, i) => readSlot(s, this.registry, i)); this.cursor = readSlot(packet.carriedItem, this.registry); this.stateId = packet.stateId; this.revision++; return true;
  }
  updateSlot(packet) {
    if (packet.windowId === -1 && packet.slot === -1) { this.cursor = readSlot(packet.item, this.registry); this.revision++; return true; }
    if (![0, -2].includes(packet.windowId) || packet.slot < 0 || packet.slot > 45) return false;
    if (packet.windowId === -2 && packet.slot > 40) return false;
    const slot = packet.windowId !== -2 ? packet.slot : packet.slot < 9 ? packet.slot + 36 : packet.slot >= 36 && packet.slot <= 39 ? 44 - packet.slot : packet.slot === 40 ? 45 : packet.slot;
    this.slots[slot] = readSlot(packet.item, this.registry, slot); if(packet.windowId === 0)this.stateId = packet.stateId; this.revision++; return true;
  }
  items() { return this.slots.filter((s, i) => s && i >= 9); }
  count(name) { return this.items().filter(i => i.item === name || i.name === name).reduce((n, i) => n + i.count, 0); }
  held() { return this.slots[36 + this.selected] || null; }
  equipment() { return Object.fromEntries(['head','chest','legs','feet'].map((name,i)=>[name,this.slots[5+i]?structuredClone(this.slots[5+i]):null])); }
  ownedCount(name) { return this.count(name)+this.slots.slice(5,9).filter(i=>i&&(i.name===name||i.item===name)).reduce((sum,i)=>sum+i.count,0); }
  snapshot() { return Object.fromEntries([...new Set(this.items().map(i => i.item))].map(id => [id, this.count(id)])); }
}
