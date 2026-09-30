import { resourceId } from './catalog.js';

const base = { diamond: 64, emerald: 32, iron_ingot: 12, raw_iron: 8, gold_ingot: 16, coal: 4, charcoal: 4,
  crafting_table: 4, furnace: 8, stick: 0.5, cobblestone: 0.5, cobbled_deepslate: 0.5, dirt: 0.1,
  cooked_beef: 8, cooked_porkchop: 8, cooked_mutton: 6, cooked_chicken: 6, bread: 6, apple: 4 };
const count = (inventory, item) => inventory?.[resourceId(item)] ?? inventory?.[item.replace(/^minecraft:/, '')] ?? 0;
const entries = inventory => Object.entries(inventory || {}).filter(([, n]) => Number.isSafeInteger(n) && n > 0).map(([item, n]) => [resourceId(item), n]);

/** Relative utility, not a server currency. Missing goal items matter more than surplus. */
export function itemValue(item, { inventory = {}, targets = {}, food = 20 } = {}) {
  item = resourceId(item); const name = item.slice(10);
  const material = name.startsWith('diamond_') ? 64 : name.startsWith('iron_') ? 12 : name.startsWith('stone_') ? 0.5 : 1;
  const units = /_chestplate$/.test(name) ? 8 : /_leggings$/.test(name) ? 7 : /_helmet$/.test(name) ? 5 : /_boots$/.test(name) ? 4 : /_(pickaxe|axe)$/.test(name) ? 3 : /_sword$/.test(name) ? 2 : 1;
  let value = base[name] ?? (/_planks$/.test(name) ? 1 : /(_log|_wood|_stem|_hyphae)$/.test(name) ? 4 : material * units);
  if (count(inventory, item) < count(targets, item)) value *= 4;
  if (food < 14 && /^(cooked_|bread$|apple$|carrot$|baked_potato$)/.test(name)) value *= 3;
  return value;
}

export function inventoryValue(inventory, options = {}) {
  return entries(inventory).reduce((total, [item, amount]) => total + amount * itemValue(item, { ...options, inventory }), 0);
}

/** Keep the best pickaxe, goal equipment, food, fuel and a small building reserve. */
export function survivalReserves(inventory, targets = {}) {
  const reserve = Object.fromEntries(entries(targets));
  for (const item of ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']) {
    if (count(inventory, item)) { reserve[resourceId(item)] = Math.max(1, reserve[resourceId(item)] || 0); break; }
  }
  for (const [item, n] of entries(inventory)) {
    const name = item.slice(10);
    const needed = /^(cooked_|bread$|apple$|carrot$)/.test(name) ? 8 : /^(coal|charcoal|stick)$/.test(name) ? 8 : /^(cobblestone|cobbled_deepslate)$|_planks$/.test(name) ? 16 : /^(crafting_table|furnace)$/.test(name) ? 1 : /(_log|_wood|_stem|_hyphae)$/.test(name) ? 4 : 0;
    reserve[item] = Math.max(reserve[item] || 0, Math.min(n, needed));
  }
  return reserve;
}

/** A proposal only. The caller must recheck both inventories and confirm delivery. */
export function proposeTrade({ from, to, fromTargets = {}, toTargets = {}, fromFood = 20, toFood = 20, allowGift = true, maxCount = 16 } = {}) {
  if (!from || !to || !Number.isInteger(maxCount) || maxCount < 1 || maxCount > 64 || typeof allowGift !== 'boolean') throw new Error('Обмен: нужны два инвентаря, maxCount 1–64 и allowGift.');
  const fromReserve = survivalReserves(from, fromTargets), toReserve = survivalReserves(to, toTargets);
  const surplus = (inventory, reserves) => entries(inventory).map(([item, n]) => ({ item, count: Math.min(maxCount, Math.max(0, n - count(reserves, item))) })).filter(s => s.count > 0);
  const outgoing = surplus(from, fromReserve), incoming = surplus(to, toReserve);
  const fromContext = { inventory: from, targets: fromTargets, food: fromFood }, toContext = { inventory: to, targets: toTargets, food: toFood };
  let best = null;
  for (const a of outgoing) for (const b of incoming) {
    if (a.item === b.item) continue;
    // Enumerating small lots avoids claiming mutual benefit from equal base prices.
    for (let give = 1; give <= a.count; give++) for (let receive = 1; receive <= b.count; receive++) {
      const fromGain = receive * itemValue(b.item, fromContext) - give * itemValue(a.item, fromContext);
      const toGain = give * itemValue(a.item, toContext) - receive * itemValue(b.item, toContext);
      if (fromGain <= 0 || toGain <= 0) continue;
      const score = Math.min(fromGain, toGain);
      if (!best || score > best.score) best = { kind: 'trade', give: [{ item: a.item, count: give }], receive: [{ item: b.item, count: receive }], fromGain, toGain, score };
    }
  }
  if (best) return best;
  if (allowGift) for (const offer of outgoing.sort((a, b) => itemValue(b.item, toContext) - itemValue(a.item, toContext))) {
    const deficit = Math.max(0, count(toTargets, offer.item) - count(to, offer.item));
    if (deficit) return { kind: 'gift', give: [{ item: offer.item, count: Math.min(offer.count, deficit) }], receive: [], fromGain: 0, toGain: Math.min(offer.count, deficit) * itemValue(offer.item, toContext), score: 0 };
  }
  return null;
}
