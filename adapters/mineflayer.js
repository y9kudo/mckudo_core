import { normalizeObservation } from '../src/perception.js';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorldActions } from './mineflayer-actions.js';
import { blockKey } from '../src/construction.js';
const resourceName = value => {
  if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error('Mineflayer-адаптер принимает только vanilla ID minecraft:имя. Для модов нужен bridge.');
  return value.replace(/^minecraft:/, '');
};
export function createMineflayerAdapter(bot, { goals, trackedBlocks = ['minecraft:oak_log', 'minecraft:birch_log', 'minecraft:crafting_table'], watchedPositions = [] }) {
  if (!bot.pathfinder || !goals?.GoalNear || !goals?.GoalLookAtBlock) throw new Error('Загрузи mineflayer-pathfinder и передай его goals.');
  const cancel = () => { bot.pathfinder.setGoal(null); bot.stopDigging(); bot.deactivateItem(); bot.clearControlStates(); };
  const check = signal => { signal.throwIfAborted(); if (!bot.entity || bot.health <= 0) throw new Error('Бот не в мире или мёртв.'); };
  if (!Array.isArray(watchedPositions) || watchedPositions.length > 2048 || watchedPositions.some(p => !['x', 'y', 'z'].every(k => Number.isInteger(p[k])))) throw new Error('watchedPositions: до 2048 целых координат.');
  const worldActions = createWorldActions(bot, { goals, check }), attackers = new Map();
  const onHurt = (victim, source) => {
    if (victim !== bot.entity || !source || source === bot.entity) return;
    const key = String(source.id), previous = attackers.get(key), now = Date.now();
    attackers.set(key, { entityId: key, hits: previous && now - previous.lastHitAt < 10000 ? previous.hits + 1 : 1, lastHitAt: now });
    if (attackers.size > 32) attackers.delete(attackers.keys().next().value);
  };
  bot.on?.('entityHurt', onHurt);
  if (!Array.isArray(trackedBlocks) || trackedBlocks.length > 16) throw new Error('trackedBlocks: до 16 vanilla ID.');
  const blockNames = [...new Set(trackedBlocks.map(resourceName))];
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
    describe: () => ({ protocolVersion: 1, perceptionVersion: 1, kind: 'mineflayer', loader: 'vanilla', minecraftVersion: bot.version || 'unknown', skills: ['eat', 'gather', 'goto', ...(canCraft ? ['craft'] : []), ...worldActions.names] }),
    dispose: () => { bot.removeListener?.('entityHurt', onHurt); attackers.clear(); },
    observe: async ({ signal }) => {
      check(signal);
      const inventory = Object.fromEntries(Object.keys(bot.registry.itemsByName).map(name => ['minecraft:' + name, 0]));
      for (const i of bot.inventory.items()) inventory['minecraft:' + i.name] = (inventory['minecraft:' + i.name] || 0) + i.count;
      const p = bot.entity.position;
      const rawDimension = String(bot.game.dimension), dimension = rawDimension.includes(':') ? rawDimension : 'minecraft:' + rawDimension;
      const nearbyBlocks = Object.fromEntries(blockNames.map(name => ['minecraft:' + name, typeof bot.findBlock === 'function' ? Boolean(bot.findBlock({ matching: b => b.name === name, maxDistance: 24 })) : null]));
      const entities = bot.entities ? Object.values(bot.entities).filter(e => e !== bot.entity && e.position && Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) <= 32)
        .sort((a, b) => Math.hypot(a.position.x - p.x, a.position.y - p.y, a.position.z - p.z) - Math.hypot(b.position.x - p.x, b.position.y - p.y, b.position.z - p.z)).slice(0, 128)
        .map(e => ({ id: String(e.id), name: String(e.name || e.type || 'unknown'), kind: e.type === 'player' ? 'player' : 'entity', username: e.username || null,
          hostile: ['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'wither_skeleton', 'creeper', 'pillager', 'vindicator', 'ravager', 'witch', 'phantom', 'blaze', 'ghast', 'warden'].includes(e.name),
          position: { x: e.position.x, y: e.position.y, z: e.position.z } })) : null;
      for (const [id, hit] of attackers) if (Date.now() - hit.lastHitAt > 10000) attackers.delete(id);
      const blocks = Object.fromEntries(watchedPositions.map(pos => { const b = bot.blockAt(bot.entity.position.offset(pos.x - p.x, pos.y - p.y, pos.z - p.z)); return [blockKey(pos), b ? 'minecraft:' + b.name : null]; }));
      return normalizeObservation({ dimension, self: { health: bot.health, food: bot.food, position: { x: p.x, y: p.y, z: p.z } }, inventory,
        world: { dimension, nearbyBlocks, blocks }, time: { timeOfDay: bot.time?.timeOfDay ?? null, isDay: bot.time?.isDay ?? null }, entities, combat: { attackers: [...attackers.values()] } });
    },
    execute: async ({ skill, args }, { signal }) => {
      check(signal); signal.addEventListener('abort', cancel, { once: true });
      try {
        if (skill === 'eat') {
          const name = resourceName(args.item || 'minecraft:bread');
          const item = bot.inventory.items().find(i => i.name === name);
          if (!item) throw new Error(`Нет ${name} в инвентаре.`);
          await bot.equip(item, 'hand'); check(signal); await bot.consume();
        } else if (skill === 'goto') {
          if (![args.x, args.y, args.z].every(Number.isFinite)) throw new Error('goto: x, y, z должны быть числами.');
          const range = args.range ?? 2;
          if (!Number.isFinite(range) || range < 0 || range > 16) throw new Error('goto: range от 0 до 16.');
          await bot.pathfinder.goto(new goals.GoalNear(args.x, args.y, args.z, range));
        } else if (skill === 'craft') {
          if (!canCraft) throw new Error('В клиенте недоступен API крафта.');
          const name = resourceName(args.item), times = args.times ?? 1;
          if (!Number.isInteger(times) || times < 1 || times > 16) throw new Error('craft.times: целое число 1–16.');
          const item = bot.registry.itemsByName[name];
          if (!item) throw new Error(`Неизвестный предмет ${name}.`);
          let table = null, recipe = findRecipe(item, times, null, args.ingredients);
          if (!recipe) {
            table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 24 });
            if (!table) throw new Error('Нет доступного рецепта в инвентаре; рядом нет верстака.');
            recipe = findRecipe(item, times, table, args.ingredients);
            if (!recipe) throw new Error('Не хватает ингредиентов для указанного количества крафта.');
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(table.position, bot.world)); check(signal);
            table = bot.blockAt(table.position);
            if (!table || table.name !== 'crafting_table') throw new Error('Верстак исчез или изменился.');
            recipe = findRecipe(item, times, table, args.ingredients);
            if (!recipe) throw new Error('Ингредиенты изменились во время перемещения.');
          }
          const before = countItem(name), expected = recipe.result.count * times;
          for (let i = 0; i < times; i++) {
            check(signal);
            // Mineflayer has no craft AbortSignal: settle this transaction before cancelling.
            await bot.craft(recipe, 1, recipe.requiresTable ? table : null);
            check(signal);
          }
          if (countItem(name) - before < expected) throw new Error('Инвентарь не подтвердил результат крафта.');
        } else if (skill === 'gather') {
          const name = resourceName(args.block), count = args.count ?? 1;
          if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('gather: count от 1 до 16.');
          for (let n = 0; n < count; n++) {
            check(signal);
            if (bot.inventory.emptySlotCount() < 2) throw new Error('Инвентарь заполнен.');
            let block = bot.findBlock({ matching: b => b.name === name, maxDistance: 24 });
            if (!block) throw new Error(`Рядом нет ${name}.`);
            await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world)); check(signal);
            block = bot.blockAt(block.position);
            if (!block || block.name !== name) throw new Error('Целевой блок изменился.');
            const moves = bot.pathfinder.movements, old = moves.canDig;
            let safe;
            try { moves.canDig = true; safe = moves.safeToBreak(block); } finally { moves.canDig = old; }
            if (!safe) throw new Error('Этот блок небезопасно добывать.');
            const tool = bot.pathfinder.bestHarvestTool(block);
            if (tool) { await bot.equip(tool, 'hand'); check(signal); }
            if (!block.canHarvest(bot.heldItem?.type ?? null)) throw new Error('Не хватает подходящего инструмента.');
            const beforePickup = new Map();
            for (const item of bot.inventory.items()) beforePickup.set(item.name, (beforePickup.get(item.name) || 0) + item.count);
            await bot.dig(block); check(signal);
            if (bot.blockAt(block.position)?.type === block.type) throw new Error('Сервер не подтвердил добычу.');
            // Pick up drops by approaching the mined block. No teleporting or inventory injection.
            await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
            // Reaching the block does not mean the server has sent the pickup yet.
            // Wait for observed inventory growth; the brain checks the precise effect.
            const pickedUp = () => {
              const current = new Map();
              for (const item of bot.inventory.items()) current.set(item.name, (current.get(item.name) || 0) + item.count);
              return [...current].some(([name, amount]) => amount > (beforePickup.get(name) || 0));
            };
            const deadline = Date.now() + 2000;
            while (!pickedUp() && Date.now() < deadline) { await delay(50, undefined, { signal }); check(signal); }
            if (!pickedUp()) throw new Error('Блок добыт, но подбор предмета не подтверждён инвентарём.');
          }
        } else if (worldActions.names.includes(skill)) await worldActions.execute(skill, args, signal);
        else throw new Error(`Навык не поддерживается: ${skill}`);
        check(signal); return { ok: true };
      } finally { signal.removeEventListener('abort', cancel); }
    },
  };
}
