const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
import {shieldThreat} from './shield-threats.js';

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

/** Reach is measured from the eye to the observed entity volume, not feet to feet. */
export function meleeGeometry(self, target, { width = .6, height = 1.8, reach = 3 } = {}) {
  if (!self?.position || !target?.position || ![width,height,reach].every(Number.isFinite) || width <= 0 || height <= 0 || reach <= 0) return { inReach: false, distance: Infinity, aim: null };
  const eye = { ...self.position, y: self.position.y + (self.eyeHeight ?? 1.62) }, p = target.position;
  const nearest = { x: Math.max(p.x-width/2,Math.min(p.x+width/2,eye.x)), y: Math.max(p.y,Math.min(p.y+height,eye.y)), z: Math.max(p.z-width/2,Math.min(p.z+width/2,eye.z)) };
  const d = distance(eye, nearest);
  return { inReach: d <= reach, distance: d, aim: { x: p.x, y: Math.max(p.y+height*.15,Math.min(p.y+height*.85,eye.y)), z: p.z } };
}

/** Intersect the current look ray with the entity body within ordinary reach. */
export function meleeRayIntersection(self,target,{width=.6,height=1.8,reach=3}={}) {
  if(!self?.position||!target?.position||![self.yaw,self.pitch,width,height,reach].every(Number.isFinite)||width<=0||height<=0||reach<=0)return null;
  const origin={...self.position,y:self.position.y+(self.eyeHeight??1.62)},p=target.position;
  const yaw=self.yaw*Math.PI/180,pitch=self.pitch*Math.PI/180;
  const direction={x:-Math.sin(yaw)*Math.cos(pitch),y:-Math.sin(pitch),z:Math.cos(yaw)*Math.cos(pitch)};
  let near=0,far=reach;
  for(const axis of ['x','y','z']){
    const min=axis==='y'?p.y:p[axis]-width/2,max=axis==='y'?p.y+height:p[axis]+width/2;
    if(Math.abs(direction[axis])<1e-9){if(origin[axis]<min||origin[axis]>max)return null;continue;}
    const a=(min-origin[axis])/direction[axis],b=(max-origin[axis])/direction[axis];
    near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return null;
  }
  return {distance:near,point:Object.fromEntries(['x','y','z'].map(axis=>[axis,origin[axis]+direction[axis]*near]))};
}

/** All deadlines in a decision must use the same clock (the executor uses performance.now). */
export function combatDecision({ self, target, projectiles = [], nextAttackAt = 0, now = Date.now(), retreatHealth = 8, criticalPending = false, canCriticalJump = false, geometry = meleeGeometry(self,target), visible = true }) {
  if (!self?.position || !target?.position) return { mode: 'stop', reason: "No confirmed target." };
  const d = distance(self.position, target.position);
  if (self.health == null || self.health <= retreatHealth || target.name === 'creeper' && d < 5) return { mode: 'retreat', reason: "Keeping your distance in danger." };
  const incoming = shieldThreat(self,projectiles.map(e=>e.name?e:{...e,name:'arrow'}),{anticipate:false});
  const enemyAxe=weaponProfile(target.equipment?.[0]?.name).kind==='axe';
  if (self.shield && now >= (self.shieldDisabledUntil||0) && (incoming || target.charging && d > 3 || !enemyAxe && visible && geometry.distance < 3.2 && now < nextAttackAt)) return { mode: 'block', ...(incoming?{guardPoint:incoming.point}:{}), reason: incoming ? 'Face and intercept the incoming projectile.' : 'Guard while the weapon recharges.' };
  if (!geometry.inReach || !visible) return { mode: 'approach', reason: visible ? 'Close to ordinary melee reach.' : 'Find a visible approach around the obstruction.' };
  if (criticalPending) {
    if(!self.onGround&&self.velocity?.y<-.08&&!self.sprinting&&!self.environment?.submerged&&!self.environment?.climbing&&now>=nextAttackAt)return {mode:'strike',critical:true,reason:'Strike during the descending phase of an ordinary jump.'};
    return {mode:self.onGround?'jump':'wait',reason:"Wait for the descending phase without the sprint."};
  }
  if(now>=nextAttackAt&&canCriticalJump&&!target.blocking&&!self.environment?.submerged&&!self.environment?.climbing)return {mode:'jump',reason:'Use a verified clear jump for a critical opportunity.'};
  if (now >= nextAttackAt) return { mode: 'strike', reason: target.blocking ? 'Use the selected axe against the facing shield.' : 'The weapon is charged and the target is reachable.' };
  return { mode: 'strafe', reason: 'Keep spacing while the weapon recharges.' };
}

