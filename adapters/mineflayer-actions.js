import { setTimeout as delay } from 'node:timers/promises';
import { blockKey } from '../src/construction.js';
import { resourceId } from '../src/catalog.js';
import { cropTypes } from '../src/food.js';
const nameOf = id => { const value = resourceId(id); if (!value.startsWith('minecraft:')) throw new Error('Mineflayer принимает vanilla ID.'); return value.slice(10); };

export function createWorldActions(bot, { goals, check, searchRadius = 128 }) {
  const names = [];
  if (typeof bot.placeBlock === 'function' && goals.GoalPlaceBlock) names.push('place');
  if (typeof bot.openFurnace === 'function') names.push('smelt');
  if (typeof bot.attack === 'function') names.push('attack', 'flee', 'hunt');
  if (typeof bot.dig === 'function' && typeof bot.placeBlock === 'function') names.push('harvest');
  const vector = p => bot.entity.position.offset(p.x - bot.entity.position.x, p.y - bot.entity.position.y, p.z - bot.entity.position.z);
  const count = name => bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
  const item = name => bot.inventory.items().find(i => i.name === name);
  return { names, async execute(skill, args, signal) {
    if (skill === 'place') {
      if (!['x', 'y', 'z'].every(k => Number.isInteger(args[k]) && Math.abs(args[k]) <= 30000000)) throw new Error('place: нужны целые координаты.');
      const name = nameOf(args.block), p = vector(args), current = bot.blockAt(p);
      if (!current) throw new Error('Целевая ячейка не загружена.');
      if (current.name === name) return;
      if (!['air', 'cave_air', 'void_air'].includes(current.name)) throw new Error('Целевая ячейка занята; перезапись блоков запрещена.');
      if (!item(name)) throw new Error(`Нет ${name} для установки.`);
      const goal = new goals.GoalPlaceBlock(p, bot.world, { range: 4, LOS: true });
      await bot.pathfinder.goto(goal); check(signal);
      if (!['air', 'cave_air', 'void_air'].includes(bot.blockAt(p)?.name)) throw new Error('Ячейка изменилась во время движения.');
      const face = goal.getFaceAndRef(bot.entity.position.offset(0, 1.6, 0));
      if (!face) throw new Error('Нет доступной грани для установки блока.');
      const reference = bot.blockAt(face.ref);
      await bot.equip(item(name), 'hand'); check(signal);
      await bot.placeBlock(reference, face.face.scaled(-1)); check(signal);
      if (bot.blockAt(p)?.name !== name) throw new Error(`Не подтверждён блок в ${blockKey(args)}.`);
    } else if (skill === 'harvest') {
      if (!['x', 'y', 'z'].every(k => Number.isInteger(args[k]))) throw new Error('harvest: нужны целые координаты.');
      const name = nameOf(args.block), crop = cropTypes[name], position = vector(args);
      if (!crop || typeof args.replant !== 'boolean') throw new Error('Неподдерживаемая культура или replant.');
      let block = bot.blockAt(position);
      const mature = b => b?.name === name && b.getProperties().age === crop.age;
      if (!mature(block)) throw new Error('Урожай ещё не созрел или блок изменился.');
      await bot.pathfinder.goto(new goals.GoalLookAtBlock(position, bot.world)); check(signal);
      block = bot.blockAt(position); if (!mature(block)) throw new Error('Зрелость урожая изменилась.');
      const before = bot.inventory.items().reduce((s, i) => s + i.count, 0);
      await bot.dig(block); check(signal);
      await bot.pathfinder.goto(new goals.GoalNear(args.x, args.y, args.z, 1)); check(signal);
      const deadline = Date.now() + 2000;
      while (bot.inventory.items().reduce((s, i) => s + i.count, 0) <= before && Date.now() < deadline) await delay(50, undefined, { signal });
      check(signal);
      if (bot.inventory.items().reduce((s, i) => s + i.count, 0) <= before) throw new Error('Подбор урожая не подтверждён.');
      if (args.replant) {
        const soil = bot.blockAt(position.offset(0, -1, 0));
        if (soil?.name !== 'farmland' || !['air', 'cave_air'].includes(bot.blockAt(position)?.name) || !item(crop.seed)) throw new Error('Урожай собран, но для посадки нет семян, грядки или свободного места.');
        await bot.equip(item(crop.seed), 'hand'); check(signal); await bot.placeBlock(soil, position.minus(soil.position)); check(signal);
        if (bot.blockAt(position)?.name !== name) throw new Error('Посадка не подтверждена сервером.');
      }
    } else if (skill === 'smelt') {
      const input = nameOf(args.input), output = nameOf(args.item), fuel = nameOf(args.fuel);
      const station = nameOf(args.station || 'minecraft:furnace');
      if (!['furnace', 'smoker', 'blast_furnace'].includes(station)) throw new Error('Нужна печь, коптильня или плавильная печь.');
      if (![args.count, args.fuelCount].every(n => Number.isInteger(n) && n > 0 && n <= 64)) throw new Error('smelt: count и fuelCount от 1 до 64.');
      if (count(input) < args.count + (fuel === input ? args.fuelCount : 0) || count(fuel) < args.fuelCount) throw new Error('Не хватает сырья или топлива.');
      let block = bot.findBlock({ matching: b => b.name === station, maxDistance: searchRadius });
      if (!block) throw new Error('Рядом нет печи.');
      await bot.pathfinder.goto(new goals.GoalLookAtBlock(block.position, bot.world)); check(signal);
      block = bot.blockAt(block.position); if (block?.name !== station) throw new Error('Печь исчезла.');
      const furnace = await bot.openFurnace(block);
      try {
        check(signal);
        if (furnace.inputItem() || furnace.outputItem() || furnace.fuelItem()) throw new Error('Печь занята. Ядро не забирает чужое содержимое.');
        const before = count(output);
        await furnace.putFuel(item(fuel).type, null, args.fuelCount); check(signal);
        await furnace.putInput(item(input).type, null, args.count); check(signal);
        const deadline = Date.now() + args.count * 12000 + 5000;
        while (count(output) - before < args.count) {
          check(signal);
          const produced = furnace.outputItem();
          if (produced) {
            if (produced.name !== output) throw new Error('Печь произвела неожиданный предмет.');
            await furnace.takeOutput(); check(signal);
          }
          if (Date.now() > deadline) throw new Error('Истекло время ожидания плавки.');
          if (count(output) - before < args.count) await delay(250, undefined, { signal });
        }
      } finally { furnace.close(); }
    } else {
      const entity = bot.entities?.[args.entityId];
      if (!entity?.position || entity === bot.entity) throw new Error('Цель боя исчезла или недопустима.');
      const maxDistance = args.maxDistance ?? 12;
      if (!Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 32) throw new Error('Дистанция боя: 1–32.');
      if (entity.position.distanceTo(bot.entity.position) > maxDistance) throw new Error('Цель за пределами дистанции преследования.');
      if (skill === 'hunt' && (entity.type === 'player' || !['cow', 'pig', 'chicken', 'sheep', 'rabbit'].includes(entity.name))) throw new Error('Цель не разрешена для охоты.');
      if (skill === 'flee') {
        const dx = bot.entity.position.x - entity.position.x, dz = bot.entity.position.z - entity.position.z, length = Math.hypot(dx, dz) || 1;
        const x = bot.entity.position.x + (dx === 0 && dz === 0 ? 1 : dx / length) * 6, z = bot.entity.position.z + dz / length * 6;
        await bot.pathfinder.goto(new goals.GoalNear(x, bot.entity.position.y, z, 2)); check(signal); return;
      }
      if (!['attack', 'hunt'].includes(skill)) throw new Error('Неизвестное действие мира.');
      const weapon = bot.inventory.items().filter(i => /_(sword|axe)$/.test(i.name)).sort((a, b) => {
        const tier = i => ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(t => i.name.startsWith(t)); return tier(b) - tier(a);
      })[0];
      if (weapon) { await bot.equip(weapon, 'hand'); check(signal); }
      if (entity.position.distanceTo(bot.entity.position) > 3) {
        await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2)); check(signal);
      }
      if (!bot.entities[args.entityId] || entity.position.distanceTo(bot.entity.position) > 3) throw new Error('Цель вне досягаемости удара.');
      await bot.lookAt(entity.position.offset(0, Math.min(entity.height || 1, 1.2), 0)); check(signal);
      bot.attack(entity);
      await delay(1000, undefined, { signal }); check(signal);
      if (skill === 'hunt' && !bot.entities[args.entityId]) {
        await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 1)); check(signal);
        await delay(1000, undefined, { signal }); check(signal);
      }
    }
  } };
}
