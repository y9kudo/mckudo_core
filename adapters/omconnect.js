import { normalizeObservation } from '../src/perception.js';
import { catalogFromMinecraftData } from '../src/catalog.js';
import { createBlockTaxonomy } from '../src/taxonomy.js';
import { isStorageBlock } from '../packages/omconnect/src/containers.js';
import {createPerceptionTracker} from '../src/perception-tracker.js';
import {createEntitySensor,hostileEntity} from '../src/entity-perception.js';
import {shieldFaces} from '../packages/omconnect/src/combat.js';
import {usingRangedWeapon} from '../packages/omconnect/src/shield-threats.js';
import {verifyMinecraftAction} from '../src/action-verification.js';

export function createOMAdapter(client, { catalog = catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}), taxonomy = createBlockTaxonomy(catalog), searchRadius = 192, trackedBlocks = ['#logs', '#ores', '#workstations', '#crops'], verifyResults = false, perception = {} } = {}) {
  if(typeof verifyResults!=='boolean')throw new Error('verifyResults must be boolean.');
  if (!Number.isInteger(searchRadius) || searchRadius < 16 || searchRadius > 512) throw new Error('searchRadius: 16–512.');
  if (!Array.isArray(trackedBlocks) || trackedBlocks.length > 128 || trackedBlocks.some(s => typeof s !== 'string')) throw new Error("trackedBlocks: to 128 ID or classes.");
  if(perception!==false&&(!perception||typeof perception!=='object'||Array.isArray(perception)))throw new Error('perception: false or perception options.');
  const names = [...new Set(trackedBlocks.flatMap(s => {
    const group = s.startsWith('#') ? taxonomy.members(s.slice(1)) : [s.includes(':') ? s : 'minecraft:' + s];
    if (!group.length || group.some(n => !catalog.block(n))) throw new Error(`Unknown block/Grade ${s}.`);
    return group;
  }))];
  for (const selector of trackedBlocks.filter(s => s.startsWith('#'))) client.world.registerClass(selector.slice(1), taxonomy.members(selector.slice(1)));
  const tracked=new Set(names);
  const reservedGroups=[['logs',32],['ores',48],['crops',16],['beds',16]].map(([group,count])=>({names:taxonomy.members(group).filter(n=>tracked.has(n)),count})).filter(g=>g.names.length);
  // Item IDs are fixed for this connected registry. Keep explicit zero counts without
  // cloning every catalog record (including metadata) on every observation.
  const emptyInventory = Object.fromEntries(catalog.items().map(i => [i.id, 0]));
  let cached = null;
  const tracker=perception===false?null:createPerceptionTracker(perception),sensor=createEntitySensor(client,{radius:searchRadius,...perception,tracker});
  let detach=null;
  const activate=()=>{
    if(detach)return;const cleanups=[],on=(target,event,listener)=>{if(typeof target?.on!=='function')return;target.on(event,listener);cleanups.push(()=>target.removeListener(event,listener));};
    const scope=()=>client.state.dimension||'unknown';
    tracker?.setScope(scope());for(const e of client.entities.values())tracker?.observeEntity(e,{dimension:scope(),source:'cache'});
    on(client,'entity',e=>tracker?.observeEntity(e,{dimension:scope()}));
    on(client,'entityGone',e=>{if(e?.id!=null)tracker?.forgetEntity(e.id);});
    const reset=()=>{cached=null;sensor.clear();tracker?.clear();tracker?.setScope(scope());};
    on(client,'respawnPacket',reset);on(client,'login',reset);
    const chunk=(event,loaded)=>{tracker?.observeChunk(event,loaded,scope());if(cached){const p=cached.position,dx=Math.max(event.x*16-p.x,0,p.x-(event.x*16+16)),dz=Math.max(event.z*16-p.z,0,p.z-(event.z*16+16));if(Math.hypot(dx,dz)<=searchRadius)cached=null;else cached.revision=client.world.revision;}};
    on(client.world,'chunkLoad',e=>chunk(e,true));on(client.world,'chunkUnload',e=>chunk(e,false));
    on(client.world,'blockUpdate',event=>{
      const block=client.world.blockAt(event.position);tracker?.observeBlock({...event,name:block?.name},scope());
      if(!cached)return;const p=cached.position,inside=Math.hypot(event.position.x-p.x,event.position.y-p.y,event.position.z-p.z)<=searchRadius;
      const previous=client.registry.blocksByStateId?.[event.previous]?.name;
      if(inside&&(!previous||!block||tracked.has('minecraft:'+previous)||tracked.has('minecraft:'+block.name)))cached=null;else cached.revision=client.world.revision;
    });
    detach=()=>{for(const cleanup of cleanups)cleanup();detach=null;};
  };
  const threats = () => {
    activate();const p=client.state.position,sensed=sensor.read();
    const entities=sensed.entities.map(({e,visible,visibilityReason,evidence})=>({id:String(e.id),name:e.name,kind:e.kind,position:{...e.position},velocity:{...(e.kind==='player'?client.entityMotion?.sample(e).velocity??e.velocity:e.velocity)},ownerId:e.ownerId??null,aimingRanged:usingRangedWeapon(e),blocking:shieldFaces(e,p),yaw:e.yaw??null,pitch:e.pitch??null,username:e.username??null,health:e.metadata?.health??null,phase:e.metadata?.phase??null,radius:e.metadata?.radius??null,
      visible,visibilityReason,evidence,isBaby:e.metadata?.baby===true||e.metadata?.is_baby===true,named:e.metadata?.custom_name!=null,woolColor:e.name==='sheep'?(e.metadata?.wool??0)&15:null,sheared:e.name==='sheep'?Boolean((e.metadata?.wool??0)&16):false,hostile:hostileEntity(e,{dimension:client.state.dimension,gold:sensed.gold})}));
    const inventory={};for(const item of client.inventory.items()){const id=item.item||'minecraft:'+item.name;inventory[id]=(inventory[id]||0)+item.count;}
    return {dimension:client.state.dimension,self:{entityId:client.state.entityId,velocity:{...client.state.velocity},position:{...p},health:client.state.health,food:client.state.food,shield:client.inventory.slots[45]?.name==='shield',shieldAvailable:client.inventory.slots[45]?.name==='shield'||client.inventory.count('shield')>0,shieldDisabled:performance.now()<(client.shieldDisabledUntil||0)},entities,inventory,combat:{attackers:sensed.attackers},perception:{...sensed.metrics,...(tracker?{events:tracker.snapshot()}: {})}};
  };
  return {
    perception:tracker,
    describe: () => ({ protocolVersion: 1, perceptionVersion: 1, kind: 'omconnect', loader: 'vanilla', minecraftVersion: client.options.version, skills: client.describe().skills }),
    subscribeUrgent(listener) {
      activate();
      const damage = e => { if (e.entityId === String(client.state.entityId)) listener(); };
      const entity = e => { const p = client.state.position; if (p && Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) < 48 && (usingRangedWeapon(e)||['arrow','spectral_arrow','trident','small_fireball','fireball'].includes(e.name)||Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<10&&['zombie','skeleton','creeper','blaze','ghast','magma_cube','hoglin','piglin_brute'].includes(e.name))) listener(); };
      client.on('damage', damage); client.on('entity', entity); client.on('planningReady', listener); return () => { client.removeListener('damage', damage); client.removeListener('entity', entity); client.removeListener('planningReady', listener); };
    },
    async observeThreats({ signal }) { signal.throwIfAborted(); return threats(); },
    async observe({ signal }) {
      signal.throwIfAborted(); const p = client.state.position; if (!p) throw new Error("The client hasn't received the position yet.");
      const key = `${client.state.dimension}/${Math.floor(p.x / 4)},${Math.floor(p.y / 4)},${Math.floor(p.z / 4)}`;
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
        const important=names.filter(n=>/^(?:minecraft:)?(?:crafting_table|furnace|brewing_stand|nether_portal|end_portal|end_portal_frame|nether_bricks|nether_brick_fence|nether_brick_stairs|nether_wart|warped_nylium)$/.test(n));
        if(important.length){
          const stations=await client.world.findBlocks({names:important,position:p,radius:Math.min(64,searchRadius),count:32,signal});
          scan.blocks=[...new Map([...scan.blocks,...stations.blocks].map(b=>[`${b.position.x},${b.position.y},${b.position.z}`,b])).values()];
          scan.truncated ||= stations.truncated;
        }
        const storageScan = names.some(isStorageBlock) ? await client.findStorages({radius:Math.min(64,searchRadius),count:32,signal}) : null;
        cached = { ...scan, position:{...p}, storages:storageScan?.storages || [], key, at: Date.now() };
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
    ...(verifyResults?{verifyAction:(action,context)=>verifyMinecraftAction(client,action,context)}:{}),
    dispose() { cached = null;detach?.();sensor.clear();tracker?.clear(); }
  };
}
