import { setTimeout as delay } from 'node:timers/promises';
import { combatDecision, chooseWeapon, weaponProfile } from '../src/combat.js';
import { isAir, isFullBlock } from '../src/navigation.js';

export function entityMeta(bot, entity, field) {
  const index = bot.registry?.entitiesByName?.[entity.name]?.metadataKeys?.indexOf(field) ?? -1;
  return index < 0 ? null : entity.metadata?.[index] ?? null;
}
export function entityCombatState(bot, e) {
  const flags = entityMeta(bot, e, 'living_entity_flags');
  return { id: String(e.id), name: e.name, position: { x: e.position.x, y: e.position.y, z: e.position.z },
    ranged: ['skeleton', 'stray', 'bogged', 'pillager', 'blaze', 'ghast'].includes(e.name) || ['bow', 'crossbow'].includes(e.heldItem?.name),
    blocking: flags != null && Boolean(flags & 1) && e.equipment?.some(i => i?.name === 'shield'),
    charging: e.name === 'blaze' && Boolean(entityMeta(bot, e, 'flags') & 1),
    health: entityMeta(bot, e, 'health'), phase: entityMeta(bot, e, 'phase'),
    velocity: e.velocity ? { x: e.velocity.x, y: e.velocity.y, z: e.velocity.z } : null };
}
export function createCombatExecutor(bot, { goals, check, clock = Date.now }) {
  let nextAttackAt = 0, lastWeapon = '', shieldUp = false, goalKey = '';
  const stop = () => { bot.pathfinder.setGoal(null); bot.clearControlStates(); if (shieldUp) bot.deactivateItem(); shieldUp = false; goalKey = ''; };
  const shield = active => { if (active === shieldUp) return; if (active) bot.activateItem(true); else bot.deactivateItem(); shieldUp = active; };
  const safeStep = (dx, dz) => {
    const p = bot.entity.position.offset(dx, 0, dz).floored();
    return isAir(bot.blockAt(p)) && isAir(bot.blockAt(p.offset(0, 1, 0))) && isFullBlock(bot.blockAt(p.offset(0, -1, 0)));
  };
  return { stop, state: () => ({ nextAttackAt, shieldUp }), async execute(args, signal) {
    const duration = args.durationMs ?? 400, maxDistance = args.maxDistance ?? 16, retreatHealth = args.retreatHealth ?? 8;
    if (!Number.isInteger(duration) || duration < 50 || duration > 2000 || !Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 64 || !Number.isFinite(retreatHealth) || retreatHealth < 1 || retreatHealth > 20) throw new Error("combat: Wrong budget or distance.");
    const target = bot.entities?.[args.entityId];
    if (!target || target === bot.entity || target.position.distanceTo(bot.entity.position) > maxDistance) throw new Error("The target is not available.");
    const deadline = clock() + duration;
    try {
      const available = [...bot.inventory.items()];
      const selected = chooseWeapon(available, { shieldedTarget: entityCombatState(bot, target).blocking });
      if (selected && bot.heldItem?.type !== selected.type) {
        shield(false);
        if (selected.slot >= 36 && selected.slot <= 44 && bot.setQuickBarSlot) bot.setQuickBarSlot(selected.slot - 36); else await bot.equip(selected, 'hand');
        check(signal);
      }
      if (lastWeapon !== (bot.heldItem?.name || '')) { lastWeapon = bot.heldItem?.name || ''; nextAttackAt = clock() + weaponProfile(lastWeapon).cooldownMs; }
      const guard = bot.inventory.items().find(i => i.name === 'shield');
      if (guard && bot.inventory.slots?.[45]?.name !== 'shield' && !bot.supportFeature?.('doesntHaveOffHandSlot')) { await bot.equip(guard, 'off-hand'); check(signal); }
      while (clock() < deadline) {
        check(signal);
        if (bot.entities?.[args.entityId] !== target || target.isValid === false || entityMeta(bot, target, 'health') === 0) return { ok: true, targetGone: true };
        const d = target.position.distanceTo(bot.entity.position); if (d > maxDistance) throw new Error("Target moved beyond pursuit range.");
        const self = { position: bot.entity.position, health: bot.health, shield: bot.inventory.slots?.[45]?.name === 'shield' };
        const projectiles = Object.values(bot.entities).filter(e => ['arrow', 'spectral_arrow', 'small_fireball', 'fireball', 'trident'].includes(e.name)).map(e => entityCombatState(bot, e));
        const tactic = combatDecision({ self, target: entityCombatState(bot, target), projectiles, now: clock(), nextAttackAt, retreatHealth });
        if (tactic.mode === 'approach') {
          shield(false);
          const key = target.position.floored().toString();
          if (goalKey !== key) { bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)); goalKey = key; }
        } else {
          bot.pathfinder.setGoal(null); goalKey = ''; bot.clearControlStates();
          await bot.lookAt(target.position.offset(0, Math.min(target.height || 1, 1.2), 0), true); check(signal);
          shield(tactic.mode === 'block' && self.shield);
          if (tactic.mode === 'strike' && d <= 3 && bot.canSeeEntity?.(target) !== false) { bot.attack(target); nextAttackAt = clock() + weaponProfile(bot.heldItem?.name).cooldownMs; }
          if (['retreat', 'strafe'].includes(tactic.mode)) {
            const delta = target.position.minus(bot.entity.position), length = Math.hypot(delta.x, delta.z) || 1;
            if (tactic.mode === 'retreat') { if (safeStep(-delta.x / length, -delta.z / length)) bot.setControlState('back', true); }
            else { const left = Math.floor(clock() / 700) % 2 === 0, side = left ? -1 : 1; if (safeStep(side * delta.z / length, -side * delta.x / length)) bot.setControlState(left ? 'left' : 'right', true); }
          }
        }
        await delay(50, undefined, { signal });
      }
      return { ok: true, nextAttackAt };
    } finally { stop(); }
  } };
}
