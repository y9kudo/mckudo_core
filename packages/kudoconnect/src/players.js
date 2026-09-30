const wrap = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
export function gazeAngles(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, dz) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI };
}
export function gazeError(observer, target) {
  if (!observer?.position || !target?.position || !Number.isFinite(observer.headYaw ?? observer.yaw) || !Number.isFinite(observer.pitch)) return null;
  const expected = gazeAngles({ ...observer.position, y: observer.position.y + (observer.eyeHeight ?? 1.62) }, { ...target.position, y: target.position.y + (target.eyeHeight ?? 1.62) });
  return Math.hypot(wrap(expected.yaw - (observer.headYaw ?? observer.yaw)), expected.pitch - observer.pitch);
}

/** Tab-list identity is separate from spatial evidence. A listed player can have no entity. */
export class KudoPlayers {
  constructor(client) { this.client = client; this.directory = new Map(); }
  update(packet) {
    for (const row of packet.data || []) {
      const old = this.directory.get(row.uuid) || { uuid: row.uuid, username: null, listed: null, latency: null, gameMode: null };
      if (packet.action?.add_player && row.player?.name) old.username = row.player.name;
      if (packet.action?.update_listed) old.listed = Boolean(row.listed);
      if (packet.action?.update_latency) old.latency = row.latency;
      if (packet.action?.update_game_mode) old.gameMode = row.gamemode;
      if (!this.directory.has(row.uuid) && this.directory.size >= 1024) continue;
      this.directory.set(row.uuid, old);
      for (const e of this.client.entities.values()) if (e.uuid === row.uuid) this.enrich(e);
    }
  }
  remove(packet) { for (const uuid of packet.players || []) { this.directory.delete(uuid); for (const e of this.client.entities.values()) if (e.uuid === uuid) { e.username = null; e.identityKnown = false; } } }
  enrich(e) {
    if (e.kind !== 'player') return e;
    const identity = this.directory.get(e.uuid); e.username = identity?.username ?? null; e.identityKnown = Boolean(e.username); e.eyeHeight ??= 1.62;
    return e;
  }
  entity(selector) {
    const value = typeof selector === 'string' ? selector.toLowerCase() : '';
    return [...this.client.entities.values()].find(e => e.kind === 'player' && e.identityKnown && (e.uuid?.toLowerCase() === value || e.username?.toLowerCase() === value)) || null;
  }
  snapshot() {
    return [...this.directory.values()].map(p => {
      const e = this.entity(p.uuid);
      return { ...p, entityId: e?.id ?? null, observed: Boolean(e), position: e ? { ...e.position } : null,
        yaw: e?.yaw ?? null, headYaw: e?.headYaw ?? null, pitch: e?.pitch ?? null,
        managedAgent: this.client.managedNames?.has(p.username?.toLowerCase()) || false };
    });
  }
}

/** A cancellable attention lease; game actions retain priority over social gaze. */
export class KudoAttention {
  constructor(client) { this.client = client; this.leases = new Map(); this.nextId = 0; this.last = { status: 'idle', target: null }; }
  watch(username, { durationMs = 10000, maxDistance = 16, priority = 10, turnSpeed = 540 } = {}) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(username) || !Number.isInteger(durationMs) || durationMs < 100 || durationMs > 300000 || !Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 128 || !Number.isFinite(priority) || priority < -1000 || priority > 1000 || !Number.isFinite(turnSpeed) || turnSpeed < 30 || turnSpeed > 1440 || this.leases.size >= 16) throw new Error('watchPlayer: имя, durationMs 100–300000, distance 1–128, priority и turnSpeed 30–1440.');
    const lease = { id: ++this.nextId, username, uuid: this.client.players.entity(username)?.uuid ?? null, expiresAt: Date.now() + durationMs, maxDistance, priority, turnSpeed };
    this.leases.set(lease.id, lease);
    return { stop: () => this.leases.delete(lease.id), snapshot: () => ({ ...lease, active: this.leases.has(lease.id) }) };
  }
  tick(dt = .05) {
    const c = this.client, now = Date.now();
    for (const [id, l] of this.leases) if (l.expiresAt <= now) this.leases.delete(id);
    const l = [...this.leases.values()].sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
    if (!l) { this.last = { status: 'idle', target: null }; return; }
    if (c.pending && (!['drop', 'select', 'wait', 'eat'].includes(c.pending.skill) || c.pending.priority > l.priority)) { this.last = { status: 'yielded', target: l.username }; return; }
    const e = c.players.entity(l.uuid || l.username);
    if (!e) { this.last = { status: 'lost', target: l.username }; return; }
    l.uuid ||= e.uuid;
    const from = { ...c.state.position, y: c.state.position.y + 1.62 }, to = { ...e.position, y: e.position.y + (e.eyeHeight || 1.62) };
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (d > l.maxDistance) { this.last = { status: 'out-of-range', target: l.username }; return; }
    // Social attention respects visible blocks and unknown space, not tab-list coordinates.
    for (let t = 0; t < d; t += .1) {
      const p = { x: from.x + (to.x - from.x) * t / d, y: from.y + (to.y - from.y) * t / d, z: from.z + (to.z - from.z) * t / d }, b = c.world.blockAt(p);
      if (!b || b.shapes?.some(s => ['x','y','z'].every((k, i) => p[k] - Math.floor(p[k]) > s[i] && p[k] - Math.floor(p[k]) < s[i + 3]))) { this.last = { status: 'occluded', target: l.username }; return; }
    }
    // A completed navigation action may have left a smooth-look target behind.
    // The social lease owns gaze now; do not let tickLook pull it back each tick.
    c.cancelLook?.();
    const angles = gazeAngles(from, to), limit = l.turnSpeed * Math.min(.1, Math.max(0, dt));
    c.state.yaw = wrap(c.state.yaw + Math.max(-limit, Math.min(limit, wrap(angles.yaw - c.state.yaw))));
    c.state.pitch += Math.max(-limit, Math.min(limit, angles.pitch - c.state.pitch));
    this.last = { status: 'tracking', target: l.username, entityId: e.id, errorDegrees: gazeError({ ...c.state, headYaw: c.state.yaw }, e) };
  }
  clear() { this.leases.clear(); this.last = { status: 'idle', target: null }; }
}
