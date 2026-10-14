import { normalizeObservation } from '../src/perception.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorldActions } from './mineflayer-actions.js';
import { blockKey } from '../src/construction.js';
import { catalogFromMinecraftData } from '../src/catalog.js';
import { createBlockTaxonomy } from '../src/taxonomy.js';
import { cropTypes } from '../src/food.js';
import { createNavigator } from './mineflayer-navigation.js';
import { createCombatExecutor, entityCombatState } from './mineflayer-combat.js';
import { createDropCollector } from './mineflayer-drops.js';
import { createEndgameExecutor } from './mineflayer-endgame.js';
const resourceName = value => {
  if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error("Mineflayer-adapter only accepts vanilla ID minecraft:name. You need fashion bridge.");
  return value.replace(/^minecraft:/, '');
};
export function createMineflayerAdapter(bot, { goals, catalog, taxonomy, trackedBlocks, watchedPositions = [], searchRadius = 128, entityRadius = 128, scanIntervalMs = 1000, requestedViewDistance = 16 }) {
  if (!bot.pathfinder || !goals?.GoalNear || !goals?.GoalLookAtBlock) throw new Error("Load mineflayer-pathfinder and pass it on goals.");
  for (const [name, value, min, max] of [['searchRadius', searchRadius, 16, 512], ['entityRadius', entityRadius, 16, 512], ['scanIntervalMs', scanIntervalMs, 100, 60000], ['requestedViewDistance', requestedViewDistance, 2, 32]]) if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}: ${min}–${max}.`);
  catalog ||= bot.registry?.blocksArray && bot.registry?.itemsArray ? catalogFromMinecraftData(bot.registry) : null;
  taxonomy ||= catalog ? createBlockTaxonomy(catalog) : null;
  trackedBlocks ||= taxonomy ? ['#logs', '#ores', '#workstations', '#crops'] : ['minecraft:oak_log', 'minecraft:birch_log', 'minecraft:crafting_table'];
  if (!Array.isArray(trackedBlocks) || trackedBlocks.length > 128) throw new Error("trackedBlocks: to 128 ID or #classes.");
  const resolveBlocks = selector => selector.startsWith('#') ? (() => { const members = taxonomy?.members(selector.slice(1)); if (!members?.length) throw new Error(`Unknown or empty ${selector}.`); return members.map(resourceName); })() : [resourceName(selector)];
  const blockGroups = trackedBlocks.map(resolveBlocks), blockNames = [...new Set(blockGroups.flat())];
  if (blockNames.length > 2048) throw new Error("No more than 2048 Type of blocks in one scan.");
  const cancel = () => { endgame.cancel(); bot.pathfinder.setGoal(null); bot.stopDigging(); bot.deactivateItem(); bot.clearControlStates(); };
  const check = signal => { signal.throwIfAborted(); if (!bot.entity || bot.health <= 0) throw new Error("The Bot is not in the world or dead."); };
  if (!Array.isArray(watchedPositions) || watchedPositions.length > 2048 || watchedPositions.some(p => !['x', 'y', 'z'].every(k => Number.isInteger(p[k])))) throw new Error("watchedPositions: to 2048 coordinates.");
  const worldActions = createWorldActions(bot, { goals, check, searchRadius }), attackers = new Map();
  const navigate = createNavigator(bot, { searchRadius, check });
  const combatExecutor = createCombatExecutor(bot, { goals, check }), collector = createDropCollector(bot, { goals, check });
  const endgame = createEndgameExecutor(bot, { goals, check });
  let scanCache = null;
  const invalidate = () => { scanCache = null; };
  const scan = p => {
    if (scanCache && Date.now() - scanCache.at < scanIntervalMs && Math.hypot(p.x - scanCache.p.x, p.y - scanCache.p.y, p.z - scanCache.p.z) < 4) return scanCache.result;
    let positions = [], nearbyBlocks;
    const ids = blockNames.map(n => bot.registry?.blocksByName?.[n]?.id).filter(Number.isInteger);
    if (typeof bot.findBlocks === 'function' && ids.length) {
      // Separate budgets prevent dense tree trunks from hiding every ore/crop in the sample.
      for (const group of blockGroups) {
        const matching = group.map(n => bot.registry.blocksByName[n]?.id).filter(Number.isInteger);
        if (matching.length) positions.push(...bot.findBlocks({ matching, maxDistance: searchRadius, count: Math.max(1, Math.floor(512 / blockGroups.length)) }));
      }
      positions = [...new Map(positions.map(p => [blockKey(p), p])).values()];
      const present = new Set(positions.map(p => bot.blockAt(p)?.name).filter(Boolean));
      nearbyBlocks = Object.fromEntries(blockNames.map(n => ['minecraft:' + n, present.has(n) ? true : null]));
    } else nearbyBlocks = Object.fromEntries(blockNames.map(name => ['minecraft:' + name, typeof bot.findBlock === 'function' ? Boolean(bot.findBlock({ matching: b => b.name === name, maxDistance: searchRadius })) : null]));
    const crops = positions.map(p => bot.blockAt(p)).filter(b => b && cropTypes[b.name]).map(b => ({ name: 'minecraft:' + b.name, position: { x: b.position.x, y: b.position.y, z: b.position.z }, mature: b.getProperties().age === cropTypes[b.name].age }));
    const result = { nearbyBlocks, crops, sampledBlocks: positions.map(p => { const b = bot.blockAt(p); return b ? { name: 'minecraft:' + b.name, position: { x: p.x, y: p.y, z: p.z }, properties: b.getProperties?.() || {} } : null; }).filter(Boolean) };
    scanCache = { at: Date.now(), p: { x: p.x, y: p.y, z: p.z }, result }; return result;
  };
  const threats = () => {
    const p = bot.entity.position;
    const entities = bot.entities ? Object.values(bot.entities).filter(e => e !== bot.entity && e.position && Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) <= entityRadius)
      .sort((a, b) => Math.hypot(a.position.x - p.x, a.position.y - p.y, a.position.z - p.z) - Math.hypot(b.position.x - p.x, b.position.y - p.y, b.position.z - p.z)).slice(0, 128)
      .map(e => ({ id: String(e.id), name: String(e.name || e.type || 'unknown'), kind: e.type === 'player' ? 'player' : 'entity', username: e.username || null,
        hostile: ['zombie', 'zombie_villager', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'wither_skeleton', 'creeper', 'pillager', 'vindicator', 'evoker', 'vex', 'ravager', 'witch', 'phantom', 'blaze', 'breeze', 'ghast', 'warden', 'slime', 'magma_cube', 'cave_spider', 'silverfish', 'endermite', 'hoglin', 'zoglin', 'piglin_brute', 'guardian', 'elder_guardian', 'shulker', 'wither', 'ender_dragon'].includes(e.name),
        ...entityCombatState(bot, e), radius: entityMetaRadius(e) })) : null;
    for (const [id, hit] of attackers) if (Date.now() - hit.lastHitAt > 10000) attackers.delete(id);
    const rawDimension = String(bot.game?.dimension);
    return { dimension: rawDimension.includes(':') ? rawDimension : 'minecraft:' + rawDimension, self: { health: bot.health, food: bot.food ?? null, position: { x: p.x, y: p.y, z: p.z }, shield: bot.inventory?.slots?.[45]?.name === 'shield' }, entities, combat: { attackers: [...attackers.values()], ...combatExecutor.state() } };
  };
  const onHurt = (victim, source) => {
    if (victim !== bot.entity || !source || source === bot.entity) return;
    const key = String(source.id), previous = attackers.get(key), now = Date.now();
    attackers.set(key, { entityId: key, hits: previous && now - previous.lastHitAt < 10000 ? previous.hits + 1 : 1, lastHitAt: now });
    if (attackers.size > 32) attackers.delete(attackers.keys().next().value);
  };
  bot.on?.('entityHurt', onHurt);
  for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'respawn']) bot.on?.(event, invalidate);
  bot.setSettings?.({ viewDistance: requestedViewDistance });
  function entityMetaRadius(e) { const i = bot.registry?.entitiesByName?.[e.name]?.metadataKeys?.indexOf('radius') ?? -1; return i < 0 ? null : e.metadata?.[i] ?? null; }
  const canCraft = typeof bot.craft === 'function' && typeof bot.recipesFor === 'function';
  const countItem = name => bot.inventory.items().filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
  const findRecipe = (item, times, table, expectedIngredients) => {
    const candidates = bot.recipesFor(item.id, null, 1, table);
    return candidates.find(recipe => {
      if (expectedIngredients) {
        const consumed = {};
        for (const entry of recipe.delta || []) if (entry.count < 0) {
          const name = bot.registry.items[entry.id]?.name; if (!name) return false;
          consumed['minecraft:' + name] = -entry.count;
        }
        if (JSON.stringify(Object.entries(consumed).sort()) !== JSON.stringify(Object.entries(expectedIngredients).sort())) return false;
      }
      return bot.recipesFor(item.id, null, recipe.result.count * times, table).some(r => JSON.stringify(r) === JSON.stringify(recipe));
    });
  };
  return {
    describe: () => ({ protocolVersion: 1, perceptionVersion: 1, kind: 'mineflayer', loader: 'vanilla', minecraftVersion: bot.version || 'unknown', skills: ['eat', 'gather', 'goto', 'navigate', 'collect', ...(typeof bot.attack === 'function' ? ['combat'] : []), ...(canCraft ? ['craft'] : []), ...worldActions.names, ...endgame.names], perception: { searchRadius, entityRadius, requestedViewDistance, scanIntervalMs } }),
    dispose: () => { endgame.dispose(); bot.removeListener?.('entityHurt', onHurt); for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'respawn']) bot.removeListener?.(event, invalidate); attackers.clear(); scanCache = null; },
    subscribeUrgent(listener) {
      const onThreat = entity => {
        if (!bot.entity?.position || !entity?.position || entity === bot.entity) return;
        if (entity.position.distanceTo(bot.entity.position) <= 12 && (entity.type === 'player' || ['zombie', 'skeleton', 'creeper', 'blaze', 'arrow', 'small_fireball', 'area_effect_cloud', 'end_crystal', 'wither_skeleton', 'enderman'].includes(entity.name))) listener();
      };
      const onDamage = victim => { if (victim === bot.entity) listener(); };
      bot.on('entityMoved', onThreat); bot.on('entitySpawn', onThreat); bot.on('entityHurt', onDamage);
      return () => { bot.removeListener('entityMoved', onThreat); bot.removeListener('entitySpawn', onThreat); bot.removeListener('entityHurt', onDamage); };
    },
    observeThreats: async ({ signal }) => { check(signal); return threats(); },
    observe: async ({ signal }) => {
      check(signal);
      const inventory = Object.fromEntries(Object.keys(bot.registry.itemsByName).map(name => ['minecraft:' + name, 0]));
      for (const i of bot.inventory.items()) inventory['minecraft:' + i.name] = (inventory['minecraft:' + i.name] || 0) + i.count;
      const p = bot.entity.position;
      const rawDimension = String(bot.game.dimension), dimension = rawDimension.includes(':') ? rawDimension : 'minecraft:' + rawDimension;
      const scanned = scan(p), threat = threats();
      const blocks = Object.fromEntries(watchedPositions.map(pos => { const b = bot.blockAt(bot.entity.position.offset(pos.x - p.x, pos.y - p.y, pos.z - p.z)); return [blockKey(pos), b ? 'minecraft:' + b.name : null]; }));
      return normalizeObservation({ dimension, self: { health: bot.health, food: bot.food, position: { x: p.x, y: p.y, z: p.z } }, inventory,
        world: { dimension, ...scanned, blocks, searchRadius, requestedViewDistance }, time: { timeOfDay: bot.time?.timeOfDay ?? null, isDay: bot.time?.isDay ?? null }, entities: threat.entities, combat: threat.combat, drops: collector.observe(), endgame: endgame.observe() });
    },
    execute: async ({ skill, args }, { signal }) => {
      check(signal); signal.addEventListener('abort', cancel, { once: true });
      try {
        if (skill === 'combat') {
          return await combatExecutor.execute(args, signal);
        } else if (skill === 'collect') {
          return await collector.collect(args, signal);
        } else if (skill === 'eat') {
          const name = resourceName(args.item || 'minecraft:bread');
          const item = bot.inventory.items().find(i => i.name === name);
          if (!item) throw new Error(`No ${name} in inventory.`);
          await bot.equip(item, 'hand'); check(signal); await bot.consume();
        } else if (skill === 'navigate') {
          await navigate(args, signal);
        } else if (skill === 'goto') {
          if (![args.x, args.y, args.z].every(Number.isFinite)) throw new Error("goto: x, y, z must be numbers.");
          const range = args.range ?? 2;
          if (!Number.isFinite(range) || range < 0 || range > 16) throw new Error("goto: range from 0 to 16.");
          await bot.pathfinder.goto(new goals.GoalNear(args.x, args.y, args.z, range));
        } else if (skill === 'craft') {
          if (!canCraft) throw new Error("Unable to access in client API craft.");
          const name = resourceName(args.item), times = args.times ?? 1;
          if (!Number.isInteger(times) || times < 1 || times > 16) throw new Error("craft.times: an integer 1–16.");
          const item = bot.registry.itemsByName[name];
          if (!item) throw new Error(`Unknown item ${name}.`);
          let table = null, recipe = findRecipe(item, times, null, args.ingredients);
          if (!recipe) {
            table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: searchRadius });
            if (!table) throw new Error("No available inventory recipe; no nearby crafting table.");
            recipe = findRecipe(item, times, table, args.ingredients);
            if (!recipe) throw new Error("Missing ingredients for the specified number of craft.");
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(table.position, bot.world)); check(signal);
            table = bot.blockAt(table.position);
            if (!table || table.name !== 'crafting_table') throw new Error("Versace has disappeared or changed.");
            recipe = findRecipe(item, times, table, args.ingredients);
            if (!recipe) throw new Error("The ingredients changed during the move.");
          }
          const before = countItem(name), expected = recipe.result.count * times;
          for (let i = 0; i < times; i++) {
            check(signal);
            // Mineflayer has no craft AbortSignal: settle this transaction before cancelling.
            await bot.craft(recipe, 1, recipe.requiresTable ? table : null);
            check(signal);
          }
          if (countItem(name) - before < expected) throw new Error("The inventory did not confirm the craft results.");
        } else if (skill === 'gather') {
          const choices = resolveBlocks(args.block), count = args.count ?? 1;
          if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error("gather: count from 1 to 16.");
          for (let n = 0; n < count; n++) {
            check(signal);
            if (bot.inventory.emptySlotCount() < 2) throw new Error("Inventory is full.");
            let block = bot.findBlock({ matching: b => choices.includes(b.name), maxDistance: searchRadius });
            if (!block) throw new Error(`No matching resource in observed terrain ${args.block}.`);
            const name = block.name;
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world)); check(signal);
            block = bot.blockAt(block.position);
            if (!block || block.name !== name) throw new Error("Target block changed.");
            const moves = bot.pathfinder.movements, old = moves.canDig;
            let safe;
            try { moves.canDig = true; safe = moves.safeToBreak(block); } finally { moves.canDig = old; }
            if (!safe) throw new Error("It's not safe to extract this block.");
            const tool = bot.pathfinder.bestHarvestTool(block);
            if (tool) { await bot.equip(tool, 'hand'); check(signal); }
            if (!block.canHarvest(bot.heldItem?.type ?? null)) throw new Error("Lack of a suitable tool.");
            const beforePickup = new Map();
            for (const item of bot.inventory.items()) beforePickup.set(item.name, (beforePickup.get(item.name) || 0) + item.count);
            const expected = args.item?.replace(/^minecraft:/, '') || catalog?.block('minecraft:' + name)?.drops?.[0]?.replace(/^minecraft:/, '') || name;
            await bot.dig(block); check(signal);
            if (bot.blockAt(block.position)?.type === block.type) throw new Error("The server didn't confirm the prey.");
            await collector.collect({ item: expected, beforeCount: beforePickup.get(expected) || 0, origin: block.position, radius: 12, timeoutMs: 8000 }, signal);
          }
        } else if (endgame.names.includes(skill)) return await endgame.execute(skill, args, signal);
        else if (worldActions.names.includes(skill)) await worldActions.execute(skill, args, signal);
        else throw new Error(`Skills not supported: ${skill}`);
        check(signal); return { ok: true };
      } finally { invalidate(); signal.removeEventListener('abort', cancel); }
    },
  };
}
