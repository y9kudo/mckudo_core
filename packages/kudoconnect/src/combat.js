const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Base Java 1.21.1 weapon mechanics, before enchantments/effects and server modifiers. */
export function weaponProfile(name = '') {
  const n = name.replace(/^minecraft:/, ''), tier = n.split('_')[0];
  if (n.endsWith('_sword')) return { damage: { wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7, netherite: 8 }[tier] || 1, cooldownMs: 625, kind: 'sword' };
  if (n.endsWith('_axe')) return { damage: { wooden: 7, golden: 7, stone: 9, iron: 9, diamond: 9, netherite: 10 }[tier] || 1, cooldownMs: { wooden: 1250, stone: 1250, iron: 1112, golden: 1000, diamond: 1000, netherite: 1000 }[tier] || 1000, kind: 'axe' };
  return { damage: 1, cooldownMs: 250, kind: 'hand' };
}
export function chooseWeapon(items, { shieldedTarget = false } = {}) {
  return items.filter(i => /_(sword|axe)$/.test(i.name || i.item || '')).sort((a, b) => {
    const score = item => { const w = weaponProfile(item.name || item.item); return w.damage / w.cooldownMs * 1000 + (shieldedTarget && w.kind === 'axe' ? 20 : 0); };
    return score(b) - score(a);
  })[0] || null;
}

export function combatDecision({ self, target, projectiles = [], nextAttackAt = 0, now = Date.now(), retreatHealth = 8 }) {
  if (!self?.position || !target?.position) return { mode: 'stop', reason: 'Нет подтверждённой цели.' };
  const d = distance(self.position, target.position);
  if (self.health == null || self.health <= retreatHealth || target.name === 'creeper' && d < 5) return { mode: 'retreat', reason: 'Сохранение дистанции при опасности.' };
  const incoming = projectiles.some(e => {
    if (!e.position || !e.velocity) return false;
    const dx = self.position.x - e.position.x, dy = self.position.y + 1 - e.position.y, dz = self.position.z - e.position.z;
    const v = e.velocity, speed2 = v.x ** 2 + v.y ** 2 + v.z ** 2;
    if (speed2 < 0.001 || Math.hypot(dx, dy, dz) > 20) return false;
    const t = (dx * v.x + dy * v.y + dz * v.z) / speed2;
    return t > 0 && t < 20 && Math.hypot(dx - v.x * t, dy - v.y * t, dz - v.z * t) < 1.5;
  });
  if (self.shield && (incoming || target.charging && d > 3 || d < 3.5 && now < nextAttackAt)) return { mode: 'block', reason: incoming ? 'Перехват наблюдаемого снаряда щитом.' : 'Защита во время восстановления удара.' };
  if (d > 2.8) return { mode: 'approach', reason: 'Сократить дистанцию до удара.' };
  if (now >= nextAttackAt) return { mode: 'strike', reason: target.blocking ? 'Удар по защищающейся цели.' : 'Готов заряженный удар.' };
  return { mode: 'strafe', reason: 'Сместиться во время восстановления удара.' };
}

