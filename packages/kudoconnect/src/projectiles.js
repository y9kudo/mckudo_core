import { fluidAt } from './environment.js';
const axes = ['x', 'y', 'z'];
const point = p => p && axes.every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const length = p => Math.hypot(p.x, p.y, p.z);
export function projectileProfile(weapon = 'bow', chargeTicks = 20) {
  if (!['bow', 'crossbow', 'trident'].includes(weapon) || !Number.isInteger(chargeTicks) || chargeTicks < 3 || chargeTicks > 100) throw new Error('Снаряд: bow/crossbow/trident и chargeTicks 3–100.');
  const pull = Math.min(1, ((chargeTicks / 20) ** 2 + chargeTicks / 10) / 3);
  return { weapon, speed: weapon === 'bow' ? 3 * pull : weapon === 'crossbow' ? 3.15 : 2.5, gravity: .05, drag: .99, waterDrag: weapon === 'trident' ? .99 : .6 };
}
function intersection(a, b, min, max) {
  let near = 0, far = 1;
  for (const k of axes) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) { if (a[k] < min[k] || a[k] > max[k]) return null; continue; }
    let t1 = (min[k] - a[k]) / d, t2 = (max[k] - a[k]) / d; if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1); far = Math.min(far, t2); if (near > far) return null;
  }
  return near;
}
function segmentCollision(a, b, getBlock) {
  let hit = null;
  for (let x = Math.floor(Math.min(a.x, b.x)); x <= Math.floor(Math.max(a.x, b.x)); x++)
    for (let y = Math.floor(Math.min(a.y, b.y)); y <= Math.floor(Math.max(a.y, b.y)); y++)
      for (let z = Math.floor(Math.min(a.z, b.z)); z <= Math.floor(Math.max(a.z, b.z)); z++) {
        const cell = { x, y, z }, block = getBlock(cell);
        const shapes = block ? block.shapes || (block.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []) : [[0, 0, 0, 1, 1, 1]];
        for (const s of shapes) {
          const t = intersection(a, b, { x: x + s[0], y: y + s[1], z: z + s[2] }, { x: x + s[3], y: y + s[4], z: z + s[5] });
          if (t !== null && (!hit || t < hit.t)) hit = { t, cell, reason: block ? 'obstacle' : 'unknown' };
        }
      }
  return hit;
}
export function traceProjectile({ origin, velocity, profile = projectileProfile(), ticks = 60, getBlock }) {
  if (!point(origin) || !point(velocity) || length(velocity) > 10 || !Number.isFinite(ticks) || ticks <= 0 || ticks > 200 || typeof getBlock !== 'function' || !Number.isFinite(profile.gravity) || profile.gravity < 0 || profile.gravity > 1 || !(profile.drag > 0 && profile.drag <= 1) || !(profile.waterDrag > 0 && profile.waterDrag <= 1)) throw new Error('Неверные параметры траектории.');
  let p = { ...origin }, v = { ...velocity }; const path = [{ ...p }];
  for (let i = 0; i < Math.ceil(ticks); i++) {
    const dt = Math.min(1, ticks - i), next = Object.fromEntries(axes.map(k => [k, p[k] + v[k] * dt]));
    const collision = segmentCollision(p, next, getBlock);
    if (collision) return { status: 'blocked', collision, path, ticks: i + collision.t * dt };
    p = next; path.push(p);
    const drag = fluidAt(getBlock(p))?.kind === 'water' ? profile.waterDrag : profile.drag;
    v = { x: v.x * drag, y: v.y * drag - profile.gravity, z: v.z * drag };
  }
  return { status: 'clear', path, position: p, ticks };
}

/** Numerical interception; yaw/pitch are Minecraft NETWORK DEGREES, positive pitch points down. */
export function solveAim({ origin, target, targetVelocity = { x: 0, y: 0, z: 0 }, inheritedVelocity = { x: 0, y: 0, z: 0 }, weapon = 'bow', chargeTicks = 20, maxTicks = 80, radius = .35, getBlock }) {
  if (![origin, target, targetVelocity, inheritedVelocity].every(point) || length(targetVelocity) > 4 || length(inheritedVelocity) > 4 || !Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > 200 || !Number.isFinite(radius) || radius <= 0 || radius > 2 || typeof getBlock !== 'function') throw new Error('Прицеливание: наблюдаемые позиции/скорости, getBlock и ограниченный горизонт.');
  const profile = projectileProfile(weapon, chargeTicks), candidates = [];
  // Linear interpolation WITHIN a discrete tick, rather than continuous drag approximation.
  const required = t => {
    const n = Math.floor(t), f = t - n, sum = (1 - profile.drag ** n) / (1 - profile.drag) + f * profile.drag ** n;
    const fall = profile.gravity / (1 - profile.drag) * (t - sum);
    const predicted = Object.fromEntries(axes.map(k => [k, target[k] + targetVelocity[k] * t]));
    const v = Object.fromEntries(axes.map(k => [k, (predicted[k] - origin[k] + (k === 'y' ? fall : 0)) / sum - inheritedVelocity[k]]));
    return { v, predicted, difference: length(v) - profile.speed };
  };
  let previous = .125, prior = required(previous);
  for (let t = .25; t <= maxTicks; t += .125) {
    const r = required(t);
    if (r.difference * prior.difference <= 0) {
      let low = previous, high = t, sign = prior.difference;
      for (let j = 0; j < 24; j++) { const mid = (low + high) / 2, d = required(mid).difference; if (d * sign > 0) low = mid; else high = mid; }
      const ticks = (low + high) / 2, shot = required(ticks); candidates.push({ ...shot, ticks });
    }
    previous = t; prior = r;
  }
  let reason = 'unreachable';
  for (const candidate of candidates) {
    const velocity = Object.fromEntries(axes.map(k => [k, candidate.v[k] + inheritedVelocity[k]]));
    const trace = traceProjectile({ origin, velocity, profile, ticks: candidate.ticks, getBlock });
    if (trace.status !== 'clear') { reason = trace.collision.reason; continue; }
    const error = length(Object.fromEntries(axes.map(k => [k, trace.position[k] - candidate.predicted[k]])));
    if (error > radius) { reason = 'medium-changed'; continue; }
    return { status: 'aimed', yaw: Math.atan2(-candidate.v.x, candidate.v.z) * 180 / Math.PI, pitch: -Math.atan2(candidate.v.y, Math.hypot(candidate.v.x, candidate.v.z)) * 180 / Math.PI, ticks: candidate.ticks, predicted: candidate.predicted, error, velocity, path: trace.path, hitConfirmed: false };
  }
  return { status: 'blocked', reason, hitConfirmed: false };
}
