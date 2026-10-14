import { setTimeout as delay } from 'node:timers/promises';
export function createDropCollector(bot, { goals, check }) {
  const drops = () => Object.values(bot.entities || {}).flatMap(e => {
    if (!['item', 'Item', 'item_stack'].includes(e.name)) return [];
    try { const item = e.getDroppedItem?.(); if (!item) return []; return [{ entity: e, item }]; }
    catch { return []; }
  });
  const count = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
  return { observe: () => drops().map(({ entity: e, item }) => ({ id: String(e.id), item: 'minecraft:' + item.name, count: item.count, position: { x: e.position.x, y: e.position.y, z: e.position.z } })),
    async collect({ item, entityId, origin, radius = 8, timeoutMs = 8000, beforeCount }, signal) {
      if (!Number.isFinite(radius) || radius < 1 || radius > 64 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('collect: radius 1–64, timeoutMs 100–30000.');
      if (item !== undefined && (typeof item !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(item))) throw new Error("collect.item: requires vanilla ID.");
      const name = item?.replace(/^minecraft:/, ''), before = name ? beforeCount ?? count(name) : null;
      const p = origin || bot.entity.position, collected = new Set();
      if (!['x', 'y', 'z'].every(k => Number.isFinite(p[k])) || before !== null && (!Number.isInteger(before) || before < 0)) throw new Error("collect: incorrect coordinates or beforeCount.");
      const onCollect = (collector, entity) => { if (collector === bot.entity) collected.add(entity.id); };
      bot.on?.('playerCollect', onCollect);
      const deadline = Date.now() + timeoutMs; let target, nextPathAt = 0, attempts = 0, goalKey = '';
      try {
        while (Date.now() < deadline) {
          check(signal);
          if (name && count(name) > before) return { ok: true, item: 'minecraft:' + name, gained: count(name) - before };
          if (target && collected.has(target.entity.id)) {
            await delay(100, undefined, { signal });
            if (!name || count(name) > before) return { ok: true, entityId: String(target.entity.id), confirmedBy: 'playerCollect' };
          }
          const candidates = drops().filter(d => (!name || d.item.name === name) && (entityId === undefined || String(d.entity.id) === String(entityId)) && Math.hypot(d.entity.position.x - p.x, d.entity.position.y - p.y, d.entity.position.z - p.z) <= radius)
            .sort((a, b) => a.entity.position.distanceTo(bot.entity.position) - b.entity.position.distanceTo(bot.entity.position));
          target = candidates[0];
          if (target && Date.now() >= nextPathAt) {
            const e = target.entity, at = e.position.floored(), key = `${e.id}:${at.x},${at.y},${at.z}`;
            // Follow the item entity after gravity/knockback, not the original mined block.
            if (key !== goalKey) { bot.pathfinder.setGoal(new goals.GoalNear(at.x, at.y, at.z, 0)); goalKey = key; attempts++; }
            nextPathAt = Date.now() + 350;
          }
          await delay(50, undefined, { signal });
        }
        throw new Error(`Pickup not confirmed: ${name || entityId || "subject"}, attempts ${attempts}.`);
      } finally { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.removeListener?.('playerCollect', onCollect); }
    }
  };
}
