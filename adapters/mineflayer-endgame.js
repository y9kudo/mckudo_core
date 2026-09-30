import { setTimeout as delay } from 'node:timers/promises';
import { createNetherPortalBlueprint, aimBow } from '../src/endgame.js';
import { entityMeta } from './mineflayer-combat.js';

/** Version-specific execution stays in the adapter. No chat commands or hidden world queries. */
export function createEndgameExecutor(bot, { goals, check }) {
  const dimension = () => { const d = String(bot.game?.dimension); return d.includes(':') ? d : 'minecraft:' + d; };
  const pos = p => ({ x: p.x, y: p.y, z: p.z });
  const vector = p => bot.entity.position.offset(p.x - bot.entity.position.x, p.y - bot.entity.position.y, p.z - bot.entity.position.z);
  const count = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
  const crystals = new Map(), explosions = [], eyes = [];
  let dragonDeath = null, ownDragonHits = 0, bowDrawing = false;
  const cancelBow = () => {
    if (!bowDrawing) return;
    // Releasing a drawn bow fires it. Switch slots first to cancel without a shot.
    bot.setQuickBarSlot((bot.quickBarSlot + 1) % 9); bowDrawing = false; bot.deactivateItem();
  };
  const remember = e => {
    if (dimension() !== 'minecraft:the_end' || e.name !== 'end_crystal' || !e.position) return;
    const previous = crystals.get(e.id);
    crystals.set(e.id, { id: String(e.id), position: pos(e.position), ...previous, lastSeenAt: Date.now() });
    if (crystals.size > 128) crystals.delete(crystals.keys().next().value);
  };
  const correlate = () => {
    for (const c of crystals.values()) if (c.goneAt && explosions.some(e => Math.abs(e.at - c.goneAt) < 2500 && Math.hypot(e.x - c.position.x, e.y - c.position.y, e.z - c.position.z) < 2)) c.destroyed = true;
  };
  const gone = e => { if (dimension() !== 'minecraft:the_end') return; const c = crystals.get(e.id); if (c) { c.goneAt = Date.now(); correlate(); } };
  const explosion = packet => {
    if (dimension() !== 'minecraft:the_end') return;
    const p = packet.position || packet;
    if (!['x', 'y', 'z'].every(k => Number.isFinite(p[k]))) return;
    explosions.push({ ...pos(p), at: Date.now() }); if (explosions.length > 32) explosions.shift(); correlate();
  };
  const hurt = (victim, source) => { if (dimension() === 'minecraft:the_end' && victim.name === 'ender_dragon' && source === bot.entity) ownDragonHits++; };
  const dead = e => { if (dimension() === 'minecraft:the_end' && e.name === 'ender_dragon') dragonDeath = { confirmed: true, entityId: String(e.id), at: Date.now(), ownDamageConfirmed: ownDragonHits > 0 }; };
  const spawn = e => { remember(e); if (e.name === 'ender_dragon' && dragonDeath?.entityId !== String(e.id)) { dragonDeath = null; ownDragonHits = 0; } };
  bot.on?.('entitySpawn', spawn); bot.on?.('entityMoved', remember); bot.on?.('entityGone', gone); bot.on?.('entityDead', dead); bot.on?.('entityHurt', hurt);
  bot._client?.on('explosion', explosion);
  const waitUntil = async (predicate, ms, signal, message) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { check(signal); if (predicate()) return; await delay(50, undefined, { signal }); }
    throw new Error(message);
  };
  const equip = async (name, signal) => { const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error(`Нужен ${name}.`); await bot.equip(item, 'hand'); check(signal); };
  const coords = p => { if (!p || !['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000)) throw new Error('Нужны целые координаты блока.'); return vector(p); };
  const blockAction = async (p, expected, item, signal) => {
    await bot.pathfinder.goto(new goals.GoalLookAtBlock(p, bot.world)); check(signal);
    const b = bot.blockAt(p); if (b?.name !== expected) throw new Error('Целевой блок изменился.');
    await equip(item, signal); await bot.activateBlock(b); check(signal);
  };
  return {
    cancel: cancelBow,
    names: typeof bot.activateBlock === 'function' ? ['ignitePortal', 'enterPortal', 'throwEye', 'fillEndFrame', 'shoot', 'breakBlock', 'evade', 'wait'] : [],
    observe() {
      for (const e of Object.values(bot.entities || {})) remember(e);
      const seen = [...crystals.values()];
      return { eyes: structuredClone(eyes), crystals: structuredClone(seen), dragonDeath: structuredClone(dragonDeath), ownDragonHits,
        allInitialCrystalsConfirmed: seen.length >= 10 && seen.every(c => c.destroyed === true) };
    },
    dispose() { bot.removeListener?.('entitySpawn', spawn); bot.removeListener?.('entityMoved', remember); bot.removeListener?.('entityGone', gone); bot.removeListener?.('entityDead', dead); bot.removeListener?.('entityHurt', hurt); bot._client?.removeListener('explosion', explosion); },
    async execute(skill, args, signal) {
      if (skill === 'ignitePortal') {
        if (!['minecraft:overworld', 'minecraft:the_nether'].includes(dimension())) throw new Error('В этом измерении нельзя активировать Nether-портал.');
        const b = createNetherPortalBlueprint(args);
        const frame = () => b.cells.every(c => bot.blockAt(vector(c))?.name === 'obsidian');
        if (!frame() || !b.air.every(c => ['air', 'cave_air', 'nether_portal'].includes(bot.blockAt(vector(c))?.name))) throw new Error('Нет полной наблюдаемой рамы или проём занят.');
        const base = vector(b.air[0]).offset(0, -1, 0);
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(base, bot.world)); check(signal);
        if (!frame()) throw new Error('Рама изменилась.');
        await equip('flint_and_steel', signal); await bot.activateBlock(bot.blockAt(base));
        await waitUntil(() => b.air.every(c => bot.blockAt(vector(c))?.name === 'nether_portal'), 3000, signal, 'Сервер не подтвердил активный портал.');
      } else if (skill === 'fillEndFrame') {
        const p = coords(args);
        if (dimension() !== 'minecraft:overworld') throw new Error('Рамка ожидается в overworld.');
        if (bot.blockAt(p)?.getProperties?.().eye === true) return { ok: true, alreadyFilled: true };
        await blockAction(p, 'end_portal_frame', 'ender_eye', signal);
        await waitUntil(() => bot.blockAt(p)?.name === 'end_portal_frame' && bot.blockAt(p).getProperties().eye === true, 2000, signal, 'Око в рамке не подтверждено.');
      } else if (skill === 'enterPortal') {
        const p = coords(args), before = dimension(), block = bot.blockAt(p);
        if (!['nether_portal', 'end_portal'].includes(block?.name)) throw new Error('Входить можно только в наблюдаемый активный портал.');
        const expected = block.name === 'end_portal' ? 'minecraft:the_end' : before === 'minecraft:the_nether' ? 'minecraft:overworld' : 'minecraft:the_nether';
        if (args.dimension && args.dimension !== expected) throw new Error('Портал ведёт в другое измерение.');
        bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 0));
        try { await waitUntil(() => dimension() === expected, 20000, signal, 'Переход между измерениями не подтверждён.'); }
        finally { bot.pathfinder.setGoal(null); bot.clearControlStates(); }
      } else if (skill === 'throwEye') {
        if (dimension() !== 'minecraft:overworld') throw new Error('Око бросают в overworld.');
        if (Object.values(bot.entities).some(e => e !== bot.entity && e.type === 'player' && e.position.distanceTo(bot.entity.position) < 16)) throw new Error('Рядом другой игрок: нельзя надёжно приписать полёт ока этому агенту.');
        const existing = new Set(Object.keys(bot.entities)), launched = pos(bot.entity.position), before = count('ender_eye');
        await equip('ender_eye', signal); await bot.look(bot.entity.yaw, 0, true); check(signal); bot.activateItem();
        let eye, ambiguous = false; const samples = [];
        try {
          await waitUntil(() => {
            const candidates = Object.values(bot.entities).filter(e => e.name === 'eye_of_ender' && !existing.has(String(e.id)) && e.position.distanceTo(vector(launched)) < 16);
            if (candidates.length > 1) { ambiguous = true; return true; }
            eye = candidates[0]; return Boolean(eye);
          }, 2000, signal, 'Не появился наблюдаемый полёт ока.');
          if (ambiguous) throw new Error('Наблюдаются несколько новых глаз: бросок неоднозначен.');
          const end = Date.now() + 2200;
          while (Date.now() < end && bot.entities[eye.id] === eye) { check(signal); samples.push(pos(eye.position)); await delay(50, undefined, { signal }); }
          if (samples.length < 3 || count('ender_eye') >= before) throw new Error('Не подтверждены расход ока и его траектория в survival.');
          const origin = samples[0], endpoint = samples.reduce((best, p) => Math.hypot(p.x - origin.x, p.z - origin.z) > Math.hypot(best.x - origin.x, best.z - origin.z) ? p : best, origin);
          const record = { dimension: dimension(), origin, end: endpoint, launched, at: Date.now() }; eyes.push(record); if (eyes.length > 32) eyes.shift();
          return { ok: true, flight: record };
        } finally { bot.deactivateItem(); }
      } else if (skill === 'shoot') {
        const target = bot.entities[args.entityId];
        if (!target || target.type === 'player' || !['end_crystal', 'ender_dragon', 'blaze', 'ghast'].includes(target.name)) throw new Error('Нет разрешённой цели для лука.');
        if (target.name === 'end_crystal' && target.position.distanceTo(bot.entity.position) < 12) throw new Error('Слишком близко к взрыву кристалла.');
        if (target.name === 'ender_dragon' && [5, 6, 7].includes(entityMeta(bot, target, 'phase'))) throw new Error('Дракон сидит: сейчас стрелы не подходят.');
        if (!count('arrow')) throw new Error('Нужны стрелы.');
        await equip('bow', signal);
        bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.activateItem(); bowDrawing = true;
        try {
          await delay(1100, undefined, { signal }); check(signal);
          if (bot.entities[args.entityId] !== target) throw new Error('Цель исчезла во время натяжения.');
          if (target.name === 'end_crystal' && target.position.distanceTo(bot.entity.position) < 12) throw new Error('Опасная близость к кристаллу перед выстрелом.');
          if (target.name === 'ender_dragon' && [5, 6, 7].includes(entityMeta(bot, target, 'phase'))) throw new Error('Дракон сел во время натяжения.');
          const origin = bot.entity.position.offset(0, 1.62, 0), aimAt = target.position.offset(0, target.name === 'ender_dragon' ? 1 : 0.5, 0);
          const first = aimBow({ origin, target: aimAt });
          if (first.status !== 'aimed') throw new Error(first.reason);
          const velocity = target.velocity || { x: 0, y: 0, z: 0 };
          const predicted = target.name === 'ender_dragon' ? aimAt.offset(velocity.x * first.ticks, velocity.y * first.ticks, velocity.z * first.ticks) : aimAt;
          const aim = aimBow({ origin, target: predicted }); if (aim.status !== 'aimed') throw new Error(aim.reason);
          for (let i = 1; i < aim.path.length; i++) {
            const start = vector(aim.path[i - 1]), delta = vector(aim.path[i]).minus(start), length = delta.norm();
            if (!bot.blockAt(vector(aim.path[i]))) throw new Error('Траектория выходит в незагруженные блоки.');
            if (length > 0 && bot.world.raycast(start, delta.scaled(1 / length), length)) throw new Error('Траектория перекрыта блоком: нужна другая позиция или разбор решётки.');
          }
          await bot.look(aim.yaw, aim.pitch, true); check(signal);
          const arrows = count('arrow'); bowDrawing = false; bot.deactivateItem();
          await waitUntil(() => count('arrow') < arrows, 2000, signal, 'Расход стрелы не подтверждён.');
          // Launch is not a hit. Crystal explosions / dragon death are tracked separately.
          return { ok: true, launched: true, predictedFlightTicks: aim.ticks };
        } finally { cancelBow(); }
      } else if (skill === 'breakBlock') {
        const p = coords(args);
        if (!['minecraft:iron_bars', 'minecraft:stone', 'minecraft:deepslate', 'minecraft:stone_bricks', 'minecraft:cracked_stone_bricks', 'minecraft:mossy_stone_bricks', 'minecraft:netherrack', 'minecraft:end_stone'].includes(args.block)) throw new Error('Блок не входит в список для прохода.');
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(p, bot.world)); check(signal);
        const b = bot.blockAt(p); if ('minecraft:' + b?.name !== args.block) throw new Error('Блок изменился.');
        if (Math.abs(p.x - bot.entity.position.x) < 1 && Math.abs(p.z - bot.entity.position.z) < 1 && p.y <= bot.entity.position.y) throw new Error('Нельзя копать под собой.');
        const moves = bot.pathfinder.movements, old = moves.canDig; let safe;
        try { moves.canDig = true; safe = moves.safeToBreak(b); } finally { moves.canDig = old; }
        if (!safe) throw new Error('Блок небезопасно разрушать.');
        const tool = bot.pathfinder.bestHarvestTool(b); if (tool) { await bot.equip(tool, 'hand'); check(signal); }
        if (!b.canHarvest(bot.heldItem?.type ?? null)) throw new Error('Нет инструмента для блока.');
        await bot.dig(b); check(signal); if (bot.blockAt(p)?.type === b.type) throw new Error('Разрушение не подтверждено.');
      } else if (skill === 'evade') {
        const source = args.from;
        if (!source || !['x', 'y', 'z'].every(k => Number.isFinite(source[k]))) throw new Error('evade.from: нужны координаты угрозы.');
        const p = bot.entity.position; let best;
        for (let i = 0; i < 16; i++) {
          const candidate = p.offset(Math.cos(i * Math.PI / 8) * 5, 0, Math.sin(i * Math.PI / 8) * 5).floored();
          if (!['air', 'cave_air'].includes(bot.blockAt(candidate)?.name) || !['air', 'cave_air'].includes(bot.blockAt(candidate.offset(0, 1, 0))?.name) || bot.blockAt(candidate.offset(0, -1, 0))?.boundingBox !== 'block') continue;
          if (!best || candidate.distanceTo(vector(source)) > best.distanceTo(vector(source))) best = candidate;
        }
        if (!best || best.distanceTo(vector(source)) <= p.distanceTo(vector(source))) throw new Error('Нет безопасного пункта отступления.');
        await bot.pathfinder.goto(new goals.GoalNear(best.x, best.y, best.z, 1)); check(signal);
      } else if (skill === 'wait') {
        const duration = args.durationMs ?? 250;
        if (!Number.isInteger(duration) || duration < 50 || duration > 2000) throw new Error('wait.durationMs: 50–2000.');
        await delay(duration, undefined, { signal });
      } else throw new Error(`Неизвестный endgame-навык ${skill}.`);
      check(signal); return { ok: true };
    }
  };
}
