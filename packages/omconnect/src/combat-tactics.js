import { chooseWeapon, weaponProfile } from './combat.js';

/** Persist across short actions: a flickering shield must not reset attack cooldown forever. */
export class CombatLoadout {
  record = null;
  choose(target, items, held, { now, shieldedTarget, avoidSweep } = {}) {
    const r = this.record;
    if (r?.target === target && r.weapon === held?.name && now < r.until && items.some(i => i.slot === held.slot && i.name === held.name)) return held;
    return chooseWeapon(items, { shieldedTarget, avoidSweep });
  }
  selected(target, weapon, now) {
    this.record = { target, weapon: weapon.name, until: now + weaponProfile(weapon.name).cooldownMs + 175 };
  }
}

/** Keep the orbit direction until geometry favors the other flank or the corridor is blocked. */
export function flankSide(self, target, previous = 1) {
  if (!Number.isFinite(target.yaw)) return previous;
  const dx = self.position.x - target.position.x, dz = self.position.z - target.position.z, d = Math.hypot(dx, dz);
  if (d < .1) return previous;
  const yaw = target.yaw * Math.PI / 180, sideDot = (-Math.sin(yaw) * -dz + Math.cos(yaw) * dx) / d;
  return Math.abs(sideDot) < .15 ? previous : sideDot > 0 ? -1 : 1;
}
