import { blockKey, planConstruction } from './construction.js';
const air = n => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(n);
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Four by five frame. Corners provide placement supports for the upper row. */
export function createNetherPortalBlueprint({ origin, axis = 'x' }) {
  if (!point(origin) || !Object.values(origin).every(Number.isInteger) || !['x', 'z'].includes(axis)) throw new Error("Portal: whole origin.x/y/z and axis x or z.");
  const cells = [], interior = [];
  for (let y = 0; y < 5; y++) for (let u = 0; u < 4; u++) {
    const p = { x: origin.x + (axis === 'x' ? u : 0), y: origin.y + y, z: origin.z + (axis === 'z' ? u : 0) };
    if (y === 0 || y === 4 || u === 0 || u === 3) cells.push({ ...p, block: 'minecraft:obsidian' }); else interior.push(p);
  }
  return { schemaVersion: 1, id: 'nether-portal', origin: { ...origin }, axis, cells, air: interior };
}
export function planNetherPortal({ blueprint, blocks, inventory = {} }) {
  const expected = createNetherPortalBlueprint({ origin: blueprint.origin, axis: blueprint.axis });
  const frameReady = expected.cells.every(p => blocks[blockKey(p)] === 'minecraft:obsidian');
  if (frameReady && expected.air.every(p => blocks[blockKey(p)] === 'minecraft:nether_portal')) return { status: 'completed', actions: [], entrance: expected.air[0] };
  const plan = planConstruction(expected, { blocks, inventory });
  if (plan.status !== 'completed') return plan;
  if (!(inventory['minecraft:flint_and_steel'] > 0)) return { status: 'needs-materials', shortages: { 'minecraft:flint_and_steel': 1 }, actions: [] };
  return { status: 'ready', actions: [{ skill: 'ignitePortal', args: { origin: expected.origin, axis: expected.axis } }] };
}

/** Recover a complete observed frame from one remembered interior cell, without hidden coordinates. */
export function observedNetherPortalFrame({interior,getBlock}){
  if(!point(interior)||!Object.values(interior).every(Number.isInteger)||typeof getBlock!=='function')throw new Error("Portal frame: interior and getBlock.");
  const name=p=>{const b=getBlock(p);return b?.name?.replace(/^minecraft:/,'')||b?.id?.replace(/^minecraft:/,'')||null;};
  for(const axis of ['x','z'])for(const u of [1,2])for(const y of [1,2,3]){
    const origin={x:interior.x-(axis==='x'?u:0),y:interior.y-y,z:interior.z-(axis==='z'?u:0)},b=createNetherPortalBlueprint({origin,axis});
    if(b.cells.every(p=>name(p)==='obsidian')&&b.air.every(p=>['air','cave_air','void_air','nether_portal'].includes(name(p))))return b;
  }
  return null;
}

/** Estimate an area from observed eye flights; no seed or hidden world information. */
export function triangulateEyes(observations, { minBaseline = 16, maxResidual = 12 } = {}) {
  if (!Array.isArray(observations) || observations.length > 32 || !Number.isFinite(minBaseline) || minBaseline < 1 || !Number.isFinite(maxResidual) || maxResidual <= 0) throw new Error("Misobserved or triangulation tolerance.");
  if (observations.length < 2) return { status: 'insufficient', reason: "I need two shots from different points." };
  const rays = observations.map(o => {
    if (o.dimension !== 'minecraft:overworld' || !point(o.origin) || !point(o.end)) throw new Error("Requires origin/end of the observed flight of the eye overworld.");
    const dx = o.end.x - o.origin.x, dz = o.end.z - o.origin.z, length = Math.hypot(dx, dz);
    if (length < 2) return null;
    return { p: o.origin, dx: dx / length, dz: dz / length };
  });
  if (rays.some(r => !r)) return { status: 'insufficient', reason: "Too short a horizontal flight; Possible proximity to the fortress." };
  let baseline = 0;
  for (const a of rays) for (const b of rays) baseline = Math.max(baseline, Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z));
  if (baseline < minBaseline) return { status: 'insufficient', reason: "Scratch the point of the throws further from each other." };
  let aa = 0, ab = 0, bb = 0, ax = 0, bx = 0;
  for (const r of rays) {
    const nx = -r.dz, nz = r.dx, d = nx * r.p.x + nz * r.p.z;
    aa += nx * nx; ab += nx * nz; bb += nz * nz; ax += nx * d; bx += nz * d;
  }
  const determinant = aa * bb - ab * ab;
  if (determinant / (rays.length ** 2) < 0.0001) return { status: 'insufficient', reason: "Directions are almost parallel: You need to move the drop point side-by-side." };
  const x = (ax * bb - bx * ab) / determinant, z = (bx * aa - ax * ab) / determinant;
  const residual = Math.sqrt(rays.reduce((s, r) => s + (-r.dz * (x - r.p.x) + r.dx * (z - r.p.z)) ** 2, 0) / rays.length);
  if (Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || residual > maxResidual || rays.some(r => (x - r.p.x) * r.dx + (z - r.p.z) * r.dz < -2)) return { status: 'inconsistent', reason: "Flights are not consistent with the overall objective.", residual };
  return { status: 'estimated', position: { x, z }, residual, baseline, rays: rays.length };
}

export function fortressEvidence(observation) {
  const blocks = (observation.world?.sampledBlocks || []).filter(b => ['minecraft:nether_bricks', 'minecraft:nether_brick_fence', 'minecraft:nether_brick_stairs'].includes(b.name));
  const blazes = (observation.entities || []).filter(e => e.name === 'blaze');
  return { candidate: observation.dimension === 'minecraft:the_nether' && (blocks.length > 0 || blazes.length > 0), blocks, blazes };
}

/** Bow trajectory model in air; execution must still verify a visible, unobstructed path. */
export function aimBow({ origin, target, speed = 3, gravity = 0.05, drag = 0.99, maxTicks = 100 }) {
  if (!point(origin) || !point(target) || ![speed, gravity, drag].every(Number.isFinite) || speed <= 0 || speed > 5 || gravity < 0 || gravity > 1 || drag <= 0 || drag > 1 || !Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > 200) throw new Error("Invalid trajectory parameters.");
  const dx = target.x - origin.x, dz = target.z - origin.z, horizontal = Math.hypot(dx, dz), dy = target.y - origin.y;
  if (horizontal < 0.1) return { status: 'blocked', reason: "Target almost vertical over the arrow." };
  let best = null;
  for (let degrees = -70; degrees <= 85; degrees += 0.25) {
    const pitch = degrees * Math.PI / 180; let x = 0, y = 0, vx = speed * Math.cos(pitch), vy = speed * Math.sin(pitch), path = [{ ...origin }];
    for (let tick = 1; tick <= maxTicks; tick++) {
      const oldX = x, oldY = y; x += vx; y += vy;
      const ratio = x >= horizontal ? (horizontal - oldX) / (x - oldX) : 1;
      const px = oldX + (x - oldX) * ratio, py = oldY + (y - oldY) * ratio;
      path.push({ x: origin.x + dx * px / horizontal, y: origin.y + py, z: origin.z + dz * px / horizontal });
      if (x >= horizontal) { const error = Math.abs(py - dy); if (!best || error < best.error) best = { status: 'aimed', yaw: Math.atan2(-dx, -dz), pitch, ticks: tick - 1 + ratio, error, path }; break; }
      vx *= drag; vy = vy * drag - gravity;
    }
  }
  return best && best.error < 0.5 ? best : { status: 'blocked', reason: "No exact trajectory in the model budget." };
}

export function dragonDecision(o) {
  if (o.dimension !== 'minecraft:the_end') return { mode: 'blocked', reason: "We need to get in End." };
  if (o.endgame?.dragonDeath?.confirmed) return { mode: 'completed', reason: "The dragon's death occurred." };
  const self = o.self, entities = o.entities || [];
  if (!self?.position || self.health == null) return { mode: 'blocked', reason: "No agent status." };
  const cloud = entities.find(e => e.name === 'area_effect_cloud' && dist(e.position, self.position) < (e.radius || 3) + 2);
  if (cloud || self.health <= 8) return { mode: 'evade', target: cloud?.position, reason: cloud ? "Out of the Cloud of Damage." : "We need to restore health." };
  const crystals = entities.filter(e => e.name === 'end_crystal').sort((a, b) => dist(a.position, self.position) - dist(b.position, self.position));
  if (crystals.length) {
    const target = crystals[0];
    if (dist(target.position, self.position) < 12) return { mode: 'evade', target: target.position, reason: "Increase distance to blast crystal." };
    return { mode: 'crystal', entityId: target.id, reason: "First destroy the observed crystal." };
  }
  const dragon = entities.find(e => e.name === 'ender_dragon');
  if (!dragon) return { mode: 'search', reason: "Dragon isn't observed; Lack of substance doesn't prove victory." };
  // Sitting phases 5/6/7 reject arrows in Java. Do not shoot into an invulnerable perch.
  if ([5, 6, 7].includes(dragon.phase)) return { mode: 'perch', entityId: dragon.id, reason: "Wait for safe opportunity to hit the head of a sitting dragon." };
  return { mode: 'dragon', entityId: dragon.id, reason: "Shots fired at a observed dragon in flight." };
}

export function createEndSafetyReactor() {
  return { id: 'overmind:end-safety', apiVersion: 1, preempt: true, react(o) {
    const decision = dragonDecision(o);
    return decision.mode === 'evade' && decision.target ? { action: { skill: 'evade', args: { from: decision.target } }, priority: 1000, reason: decision.reason } : { action: null, reason: "No observed immediate danger End." };
  } };
}

export { air as isPortalAir };
