import { setTimeout as delay } from 'node:timers/promises';
import { planRouteAsync, readRouteWorld, isAir, isFullBlock } from './navigation.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const floor = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);

/** Follow observed drops; only authoritative inventory growth confirms collection. */
export async function executeCollect(c, args, signal, { navigate }) {
  if (typeof args.item !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(args.item)) throw new Error('collect: нужен vanilla ID предмета.');
  const item = args.item.replace(/^minecraft:/, ''), before = args.beforeCount ?? c.inventory.count(item);
  const origin = { ...(args.origin || c.state.position) }, timeout = args.timeoutMs ?? 10000;
  if (!point(origin) || !Number.isInteger(before) || before < 0 || !Number.isInteger(timeout) || timeout < 100 || timeout > 30000) throw new Error('collect: неверные параметры.');
  const until = Date.now() + timeout, picked = new AbortController(); let missingSince;
  const searchSignal = AbortSignal.any([signal, picked.signal, AbortSignal.timeout(timeout)]);
  const gained = () => c.inventory.count(item) - before;
  const confirmed = () => ({ ok: true, gained: gained(), serverConfirmed: true });
  const onInventory = () => { if (gained() > 0) picked.abort(); };
  c.on('inventory', onInventory);
  try {
    while (Date.now() < until) {
      signal.throwIfAborted();
      if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error('Агент недоступен.');
      if (gained() > 0) return confirmed();
      const entities = [...c.entities.values()];
      if (args.entityId !== undefined && !entities.some(e => String(e.id) === String(args.entityId))) {
        missingSince ??= Date.now();
        // Entity removal and inventory packets may arrive separately. Another player
        // collecting the drop is never recorded as our success.
        if (Date.now() - missingSince >= 250) throw new Error('Целевая сущность исчезла; получение предмета не подтверждено.');
      } else missingSince = undefined;
      const drop = entities.filter(e => e.name === 'item' && e.item?.name === item && (args.entityId === undefined || String(e.id) === String(args.entityId)) && distance(e.position, origin) <= 16)
        .sort((a, b) => distance(a.position, c.state.position) - distance(b.position, c.state.position))[0];
      if (drop) {
        const base = floor(drop.position), candidates = [];
        for (let y = base.y - 2; y <= base.y; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const target = { x: base.x + dx, y, z: base.z + dz };
          if (isAir(c.world.blockAt(target)) && isAir(c.world.blockAt({ ...target, y: y + 1 })) && isFullBlock(c.world.blockAt({ ...target, y: y - 1 }))) candidates.push(target);
        }
        candidates.sort((a, b) => distance({ x: a.x + .5, y: a.y, z: a.z + .5 }, drop.position) - distance({ x: b.x + .5, y: b.y, z: b.z + .5 }, drop.position));
        for (const target of candidates) {
          let route; const view = readRouteWorld(c.world);
          try { route = await planRouteAsync({ start: floor(c.state.position), goal: target, getBlock: view.getBlock, maxDistance: 32, maxNodes: 3000, maxDrop: 2, signal: searchSignal }, { getRevision: view.getRevision }); }
          catch (error) { signal.throwIfAborted(); if (gained() > 0) return confirmed(); throw error; }
          if (route.status !== 'planned') continue;
          const budget = Math.min(1500, until - Date.now()); if (budget <= 0) break;
          try { await navigate(c, { ...target, range: 0, bridge: false, maxDrop: 2 }, AbortSignal.any([signal, picked.signal, AbortSignal.timeout(budget)])); }
          catch { signal.throwIfAborted(); }
          if (gained() > 0) return confirmed();
          break;
        }
      }
      await delay(Math.max(0, Math.min(50, until - Date.now())), undefined, { signal });
    }
    signal.throwIfAborted();
    if (gained() > 0) return confirmed();
    throw new Error('Подбор не подтверждён обновлением инвентаря.');
  } finally { c.off('inventory', onInventory); c.stopMovement(); }
}
