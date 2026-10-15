import {traceProjectile,projectileProfile} from './projectiles.js';
const axes = ['x', 'y', 'z'];
const zero = () => ({ x: 0, y: 0, z: 0 });
const valid = p => p && axes.every(k => Number.isFinite(p[k]));

/** Arrival-time estimates in blocks per game tick. Never extrapolate a teleport. */
export class EntityMotion {
  records = new WeakMap();
  observe(entity, { now = performance.now(), teleport = false, onGround } = {}) {
    if (!valid(entity.position) || !Number.isFinite(now)) return;
    if (typeof onGround === 'boolean') entity.onGround = onGround;
    let r = this.records.get(entity);
    const elapsed = r ? now - r.at : 0;
    const delta = r ? Object.fromEntries(axes.map(k => [k, entity.position[k] - r.position[k]])) : zero();
    if (!r || teleport || elapsed < 0 || elapsed > 500 || Math.hypot(delta.x, delta.y, delta.z) > Math.max(2, elapsed / 50 * 1.5)) {
      this.records.set(entity, { at: now, arrived: now, position: { ...entity.position }, velocity: zero(), samples: 0 });
      return;
    }
    r.arrived = now;
    // Coalesce packets delivered in one TCP burst instead of dividing by near-zero time.
    if (elapsed < 25) return;
    const measured = Object.fromEntries(axes.map(k => [k, delta[k] * 50 / elapsed]));
    const alpha = r.samples ? .8 : 1;
    r.velocity = Object.fromEntries(axes.map(k => [k, Math.abs(measured[k]) < .002 ? 0 : measured[k] * alpha + r.velocity[k] * (1 - alpha)]));
    r.at = now; r.position = { ...entity.position }; r.samples++;
  }
  sample(entity, now = performance.now()) {
    const r = this.records.get(entity);
    if (!r) return { velocity: valid(entity.velocity) ? { ...entity.velocity } : zero(), ageMs: 0, confidence: 0 };
    const ageMs = Math.max(0, now - r.arrived), decay = ageMs > 400 ? 0 : Math.exp(-Math.max(0, ageMs - 100) / 90);
    return { velocity: Object.fromEntries(axes.map(k => [k, r.velocity[k] * decay])), ageMs, confidence: Math.min(1, r.samples / 3) * decay };
  }
  projectile(entity,{now=performance.now(),getBlock}={}) {
    const r=this.records.get(entity);
    if(!r)return entity;
    const ticks=Math.max(0,(now-r.at)/50),velocity=r.samples?r.velocity:entity.velocity;
    if(ticks>30||!valid(velocity)||Math.hypot(velocity.x,velocity.y,velocity.z)>4)return {...entity,velocity:zero()};
    if(ticks<.001)return {...entity,velocity:{...velocity}};
    const profile=projectileProfile(entity.name==='trident'?'trident':'bow');
    const trace=traceProjectile({origin:r.position,velocity,profile,ticks,getBlock});
    if(trace.status!=='clear')return {...entity,position:trace.collision.point,velocity:zero()};
    const drag=profile.drag**Math.floor(ticks);
    return {...entity,position:trace.position,velocity:{x:velocity.x*drag,y:velocity.y*drag-profile.gravity*(1-drag)/(1-profile.drag),z:velocity.z*drag}};
  }
}

/** Short-horizon jump prediction, clamped to observed landing surfaces; no future inputs assumed. */
export function entityPrediction(entity, { velocity, ageMs = 0, getBlock, height = 1.8, maxTicks = 80 }) {
  if (!valid(entity.position) || !valid(velocity) || Math.hypot(velocity.x,velocity.y,velocity.z)>4 || !Number.isFinite(ageMs) || ageMs<0 || !Number.isFinite(height) || height<=0 || height>32 || !Number.isInteger(maxTicks) || maxTicks<1 || maxTicks>200 || typeof getBlock!=='function') throw new Error('Invalid bounded entity forecast.');
  const p = entity.position, path = [{ ...p }];
  let y = p.y, vy = entity.onGround === true ? 0 : velocity.y;
  const ballistic = entity.kind === 'player' && entity.onGround === false && ![1, 3, 4].includes(entity.metadata?.pose) && !/water|lava/.test(getBlock(p)?.name || '');
  let grounded = entity.onGround === true;
  for (let t = 1; t <= maxTicks + 2; t++) {
    const x = p.x + velocity.x * t, z = p.z + velocity.z * t;
    let nextY = y + (grounded ? 0 : vy);
    if (ballistic && !grounded && vy <= 0) {
      for (let by = Math.floor(y); by >= Math.floor(nextY) - 1; by--) {
        const block = getBlock({ x: Math.floor(x), y: by, z: Math.floor(z) });
        if (block?.boundingBox === 'block' && block.shapes?.some(s => s[0] === 0 && s[2] === 0 && s[3] === 1 && s[5] === 1 && y >= by + s[4] - .001 && nextY <= by + s[4])) {
          nextY = by + Math.max(...block.shapes.map(s => s[4])); grounded = true; break;
        }
      }
    }
    y = nextY; path.push({ x, y, z });
    if (ballistic && !grounded) vy = (vy - .08) * .98;
  }
  const ageTicks = Math.min(2, ageMs / 50);
  return ticks => {
    const t = Math.max(0, Math.min(maxTicks + 1.999, ticks + ageTicks)), n = Math.floor(t), f = t - n;
    return { x: path[n].x + (path[n + 1].x - path[n].x) * f, y: path[n].y + (path[n + 1].y - path[n].y) * f + height / 2, z: path[n].z + (path[n + 1].z - path[n].z) * f };
  };
}
