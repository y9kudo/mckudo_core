const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Base Java 1.21.1 weapon mechanics, before enchantments/effects and server modifiers. */
export function weaponProfile(name = '') {
  const n = name.replace(/^minecraft:/, ''), tier = n.split('_')[0];
  if (n.endsWith('_sword')) return { damage: { wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7, netherite: 8 }[tier] || 1, cooldownMs: 625, kind: 'sword' };
  if (n.endsWith('_axe')) return { damage: { wooden: 7, golden: 7, stone: 9, iron: 9, diamond: 9, netherite: 10 }[tier] || 1, cooldownMs: { wooden: 1250, stone: 1250, iron: 1112, golden: 1000, diamond: 1000, netherite: 1000 }[tier] || 1000, kind: 'axe' };
  return { damage: 1, cooldownMs: 250, kind: 'hand' };
}
export function chooseWeapon(items, { shieldedTarget = false, avoidSweep = false } = {}) {
  return items.filter(i => /_(sword|axe)$/.test(i.name || i.item || '')).sort((a, b) => {
    const score = item => { const w = weaponProfile(item.name || item.item); return w.damage / w.cooldownMs * 1000 + ((shieldedTarget || avoidSweep) && w.kind === 'axe' ? 20 : 0); };
    return score(b) - score(a);
  })[0] || null;
}

export function shieldFaces(entity, position) {
  const flags=entity.metadata?.living_entity_flags||0,hand=flags&2?1:0;
  if(!(flags&1)||entity.equipment?.[hand]?.name!=='shield'||!Number.isFinite(entity.yaw)||!entity.position)return false;
  const yaw=entity.yaw*Math.PI/180,dx=position.x-entity.position.x,dz=position.z-entity.position.z;
  return -Math.sin(yaw)*dx+Math.cos(yaw)*dz>0;
}

export function combatDecision({ self, target, projectiles = [], nextAttackAt = 0, now = Date.now(), retreatHealth = 8, criticalPending = false, canCriticalJump = false }) {
  if (!self?.position || !target?.position) return { mode: 'stop', reason: "No confirmed target." };
  const d = distance(self.position, target.position);
  if (self.health == null || self.health <= retreatHealth || target.name === 'creeper' && d < 5) return { mode: 'retreat', reason: "Keeping your distance in danger." };
  const incoming = projectiles.some(e => {
    if (!e.position || !e.velocity) return false;
    const dx = self.position.x - e.position.x, dy = self.position.y + 1 - e.position.y, dz = self.position.z - e.position.z;
    const v = e.velocity, speed2 = v.x ** 2 + v.y ** 2 + v.z ** 2;
    if (speed2 < 0.001 || Math.hypot(dx, dy, dz) > 20) return false;
    const t = (dx * v.x + dy * v.y + dz * v.z) / speed2;
    return t > 0 && t < 20 && Math.hypot(dx - v.x * t, dy - v.y * t, dz - v.z * t) < 1.5;
  });
  const enemyAxe=weaponProfile(target.equipment?.[0]?.name).kind==='axe';
  if (self.shield && now >= (self.shieldDisabledUntil||0) && (incoming || target.charging && d > 3 || !enemyAxe && d < 3.5 && now < nextAttackAt)) return { mode: 'block', reason: incoming ? "Interception of the observed shell by shield." : "Protection during re-entry." };
  if (d > 2.8) return { mode: 'approach', reason: "Shorten the distance to impact." };
  if (criticalPending) {
    if(!self.onGround&&self.velocity?.y<-.08&&!self.sprinting&&now>=nextAttackAt)return {mode:'strike',critical:true,reason:"Charged shock in descending phase of normal jump."};
    return {mode:self.onGround?'jump':'wait',reason:"Wait for the descending phase without the sprint."};
  }
  if(now>=nextAttackAt&&canCriticalJump&&!target.blocking)return {mode:'jump',reason:"Safe normal jump for critical impact."};
  if (now >= nextAttackAt) return { mode: 'strike', reason: target.blocking ? "A Impact on a Defensive Purpose." : "Ready for a loaded strike." };
  return { mode: 'strafe', reason: "Resist while reset." };
}

