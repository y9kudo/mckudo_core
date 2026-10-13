import { normalizeObservation } from '../src/perception.js';
import { catalogFromMinecraftData } from '../src/catalog.js';
import { createBlockTaxonomy } from '../src/taxonomy.js';
import { isStorageBlock } from '../packages/kudoconnect/src/containers.js';
import { traceVisibility } from '../packages/kudoconnect/src/visibility.js';

export function createKudoAdapter(client, { catalog = catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}), taxonomy = createBlockTaxonomy(catalog), searchRadius = 192, trackedBlocks = ['#logs', '#ores', '#workstations', '#crops'] } = {}) {
  if (!Number.isInteger(searchRadius) || searchRadius < 16 || searchRadius > 512) throw new Error('searchRadius: 16–512.');
  if (!Array.isArray(trackedBlocks) || trackedBlocks.length > 128 || trackedBlocks.some(s => typeof s !== 'string')) throw new Error('trackedBlocks: до 128 ID или классов.');
  const names = [...new Set(trackedBlocks.flatMap(s => {
    const group = s.startsWith('#') ? taxonomy.members(s.slice(1)) : [s.includes(':') ? s : 'minecraft:' + s];
    if (!group.length || group.some(n => !catalog.block(n))) throw new Error(`Неизвестный блок/класс ${s}.`);
    return group;
  }))];
  for (const selector of trackedBlocks.filter(s => s.startsWith('#'))) client.world.registerClass(selector.slice(1), taxonomy.members(selector.slice(1)));
  const tracked=new Set(names);
  const reservedGroups=[['logs',32],['ores',48],['crops',16],['beds',16]].map(([group,count])=>({names:taxonomy.members(group).filter(n=>tracked.has(n)),count})).filter(g=>g.names.length);
  // Item IDs are fixed for this connected registry. Keep explicit zero counts without
  // cloning every catalog record (including metadata) on every observation.
  const emptyInventory = Object.fromEntries(catalog.items().map(i => [i.id, 0]));
  let cached = null;
  const threats = () => {
    const p = client.state.position;
    const entities = [...client.entities.values()].filter(e => Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) <= searchRadius)
      .sort((a, b) => Math.hypot(a.position.x - p.x, a.position.y - p.y, a.position.z - p.z) - Math.hypot(b.position.x - p.x, b.position.y - p.y, b.position.z - p.z)).slice(0, 128)
      .map(e => ({ id: e.id, name: e.name, kind: e.kind, position: { ...e.position }, velocity: { ...e.velocity }, username: e.username ?? null, health: e.metadata.health ?? null, phase: e.metadata.phase ?? null, radius:e.metadata.radius??null,
  visible:Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<=16?traceVisibility({origin:{...p,y:p.y+1.62},target:{...e.position,y:e.position.y+Math.min(1,(client.registry.entitiesByName[e.name]?.height??1.8)*.6)},getBlock:q=>client.world.blockAt(q),maxDistance:20}).visible:null,
  isBaby:e.metadata.baby===true||e.metadata.is_baby===true,named:e.metadata.custom_name!=null,woolColor:e.name==='sheep'?(e.metadata.wool??0)&15:null,sheared:e.name==='sheep'?Boolean((e.metadata.wool??0)&16):false,
  hostile: ['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'blaze', 'wither_skeleton', 'witch', 'phantom', 'pillager', 'spider', 'cave_spider'].includes(e.name) }));
      return { dimension: client.state.dimension, self: { position: { ...p }, health: client.state.health, food: client.state.food, shield: client.inventory.slots[45]?.name === 'shield' }, entities,
      combat: { attackers: [...client.attackers.values()].filter(a => Date.now() - a.lastHitAt < 10000) } };
  };
  return {
    describe: () => ({ protocolVersion: 1, perceptionVersion: 1, kind: 'kudoconnect', loader: 'vanilla', minecraftVersion: client.options.version, skills: client.describe().skills }),
    subscribeUrgent(listener) {
      const damage = e => { if (e.entityId === String(client.state.entityId)) listener(); };
      const entity = e => { const p = client.state.position; if (p && Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) < 10 && ['zombie', 'skeleton', 'creeper', 'blaze', 'arrow'].includes(e.name)) listener(); };
      client.on('damage', damage); client.on('entity', entity); client.on('planningReady', listener); return () => { client.removeListener('damage', damage); client.removeListener('entity', entity); client.removeListener('planningReady', listener); };
    },
    async observeThreats({ signal }) { signal.throwIfAborted(); return threats(); },
    async observe({ signal }) {
      signal.throwIfAborted(); const p = client.state.position; if (!p) throw new Error('Клиент ещё не получил позицию.');
      const key = `${Math.floor(p.x / 4)},${Math.floor(p.y / 4)},${Math.floor(p.z / 4)}`;
      if (!cached || cached.key !== key || cached.revision !== client.world.revision || Date.now() - cached.at > 2000) {
        const scan = await client.world.findBlocks({ names, position: p, radius: searchRadius, count: 256, signal });
        // Dense common terrain must not erase distant but observed resource classes.
        for(const group of reservedGroups){
          const sample=await client.world.findBlocks({...group,position:p,radius:searchRadius,signal});
          scan.blocks=[...new Map([...scan.blocks,...sample.blocks].map(b=>[`${b.position.x},${b.position.y},${b.position.z}`,b])).values()];
          scan.truncated ||= sample.truncated;
        }
        // Common stone/logs can fill the sample budget before a nearby table.
        // Reserve a separate observation budget for crafting and portal stations.
        const important=names.filter(n=>/^(?:minecraft:)?(?:crafting_table|furnace|nether_portal|end_portal|end_portal_frame)$/.test(n));
        if(important.length){
          const stations=await client.world.findBlocks({names:important,position:p,radius:Math.min(64,searchRadius),count:32,signal});
          scan.blocks=[...new Map([...scan.blocks,...stations.blocks].map(b=>[`${b.position.x},${b.position.y},${b.position.z}`,b])).values()];
          scan.truncated ||= stations.truncated;
        }
        const storageScan = names.some(isStorageBlock) ? await client.findStorages({radius:Math.min(64,searchRadius),count:32,signal}) : null;
        cached = { ...scan, storages:storageScan?.storages || [], key, at: Date.now() };
      }
      const native = client.observe(), t = threats(), present = new Set(cached.blocks.map(b => b.name)), inventory = { ...emptyInventory };
      Object.assign(inventory, native.inventory); t.self.environment = native.self.environment ?? null; t.self.freeInventorySlots = native.self.freeInventorySlots;
      t.self.sleeping=client.state.sleeping??false;
      return normalizeObservation({ ...t, time:native.time, endgame:native.endgame, inventory, equipment:native.equipment, players: native.players, attention: native.attention, storage: native.storage, world: { dimension: client.state.dimension, sampledBlocks: cached.blocks.map(b => ({ ...b, properties: client.world.blockAt(b.position)?.getProperties() || {} })),
        nearbyBlocks: Object.fromEntries(names.map(n => [n.startsWith('minecraft:') ? n : 'minecraft:' + n, present.has(n.startsWith('minecraft:') ? n : 'minecraft:' + n) ? true : null])),
        storages:cached.storages, searchRadius, loadedChunks: client.world.columns.size, scanTruncated: cached.truncated },
        drops: [...client.entities.values()].filter(e => e.name === 'item' && e.item).map(e => ({ id: e.id, ...e.item, position: { ...e.position } })) });
    },
    execute: (action, { signal, priority = 0 }) => client.execute(action, { signal, priority }),
    dispose() { cached = null; }
  };
}
