const resourceName = value => {
  if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error('Mineflayer-адаптер принимает только vanilla ID minecraft:имя. Для модов нужен bridge.');
  return value.replace(/^minecraft:/, '');
};
export function createMineflayerAdapter(bot, { goals }) {
  if (!bot.pathfinder || !goals?.GoalNear || !goals?.GoalLookAtBlock) throw new Error('Загрузи mineflayer-pathfinder и передай его goals.');
  const cancel = () => { bot.pathfinder.setGoal(null); bot.stopDigging(); bot.deactivateItem(); bot.clearControlStates(); };
  const check = signal => { signal.throwIfAborted(); if (!bot.entity || bot.health <= 0) throw new Error('Бот не в мире или мёртв.'); };
  return {
    describe: () => ({ protocolVersion: 1, kind: 'mineflayer', loader: 'vanilla', minecraftVersion: bot.version || 'unknown', skills: ['eat', 'gather', 'goto'] }),
    observe: async ({ signal }) => {
      check(signal);
      const inventory = Object.fromEntries(Object.keys(bot.registry.itemsByName).map(name => ['minecraft:' + name, 0]));
      for (const i of bot.inventory.items()) inventory['minecraft:' + i.name] = (inventory['minecraft:' + i.name] || 0) + i.count;
      const p = bot.entity.position;
      return { dimension: String(bot.game.dimension), self: { health: bot.health, food: bot.food, position: { x: p.x, y: p.y, z: p.z } }, inventory };
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
            await bot.dig(block); check(signal);
            if (bot.blockAt(block.position)?.type === block.type) throw new Error('Сервер не подтвердил добычу.');
            // Pick up drops by approaching the mined block. No teleporting or inventory injection.
            await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
          }
        } else throw new Error(`Навык не поддерживается: ${skill}`);
        check(signal); return { ok: true };
      } finally { signal.removeEventListener('abort', cancel); }
    },
  };
}
