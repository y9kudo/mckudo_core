import { EventEmitter } from 'node:events';
const token = s => typeof s === 'string' && /^[A-Za-z0-9_.:/-]{1,100}$/.test(s);
const copy = value => { const text = JSON.stringify(value); if (!text || Buffer.byteLength(text) > 16384) throw new Error('Сообщение: максимум 16 KiB JSON.'); return JSON.parse(text); };

/** Local knowledge at ONE peer. Transport distributes envelopes; it does not assign work. */
export class KudoPeer extends EventEmitter {
  constructor({ id, team, peers, send, clock = Date.now, settleMs = 100 }) {
    super();
    if (!token(id) || !token(team) || !Array.isArray(peers) || peers.length < 1 || peers.length > 10 || new Set(peers).size !== peers.length || !peers.every(token) || !peers.includes(id) || typeof send !== 'function' || !Number.isInteger(settleMs) || settleMs < 0 || settleMs > 10000) throw new Error('Peer: team, id, 1–10 peers, send и settleMs 0–10000.');
    this.id = id; this.team = team; this.peers = new Set(peers); this.transport = send; this.clock = clock; this.settleMs = settleMs;
    this.sequence = 0; this.seen = new Map(); this.claims = new Map(); this.closed = false;
  }
  send(topic, payload, { to = null, ttlMs = 10000 } = {}) {
    if (this.closed || !token(topic) || to !== null && !this.peers.has(to) || !Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 30000) throw new Error('Недоступный peer, topic, получатель или TTL.');
    const envelope = copy({ protocol: 1, team: this.team, from: this.id, to, sequence: ++this.sequence, topic, payload, expiresAt: this.clock() + ttlMs });
    this.receive(envelope); this.transport(copy(envelope)); return envelope;
  }
  receive(input) {
    if (this.closed) return false;
    const e = copy(input), now = this.clock();
    if (e.protocol !== 1 || e.team !== this.team || !this.peers.has(e.from) || e.to !== null && e.to !== this.id || !token(e.topic) || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || !Number.isFinite(e.expiresAt) || e.expiresAt <= now || e.expiresAt > now + 30000) return false;
    for (const [key, until] of this.seen) if (until <= now) this.seen.delete(key);
    const key = `${e.from}/${e.sequence}`; if (this.seen.has(key)) return false;
    // Refuse pressure rather than evict replay protection for still-live envelopes.
    if (this.seen.size >= 2048) return false;
    this.seen.set(key, e.expiresAt);
    if (e.topic === 'intent') {
      const p = e.payload;
      if (!p || !token(p.resource) || typeof p.release !== 'boolean' || !Number.isFinite(p.bid) || p.bid < 0 || p.bid > 1e6) return false;
      for (const [k, claim] of this.claims) if (claim.expiresAt <= now) this.claims.delete(k);
      const k = `${p.resource}\n${e.from}`, prior = this.claims.get(k);
      if ((!prior || e.sequence > prior.sequence) && (prior || this.claims.size < 1024)) this.claims.set(k, { ...p, from: e.from, sequence: e.sequence, expiresAt: e.expiresAt, observedAt: prior && !prior.release && prior.bid === p.bid ? prior.observedAt : now });
    }
    this.emit('message', copy(e)); return true;
  }
  claim(resource, { bid = 0, ttlMs = 5000 } = {}) { if (!token(resource) || !Number.isFinite(bid) || bid < 0 || bid > 1e6) throw new Error('Неверные resource или bid.'); return this.send('intent', { resource, bid, release: false }, { ttlMs }); }
  release(resource) { if (!token(resource)) throw new Error('Неверный resource.'); return this.send('intent', { resource, bid: 0, release: true }, { ttlMs: 30000 }); }
  owner(resource) {
    const now = this.clock(), claims = [...this.claims.values()].filter(c => c.resource === resource && !c.release && c.expiresAt > now);
    if (!claims.length || claims.some(c => now - c.observedAt < this.settleMs)) return null;
    claims.sort((a, b) => a.bid - b.bid || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)); return claims[0].from;
  }
  owns(resource) { return this.owner(resource) === this.id; }
  snapshot() { return { id: this.id, team: this.team, claims: copy([...this.claims.values()].filter(c => c.expiresAt > this.clock())), messagesRemembered: this.seen.size }; }
  close() { this.closed = true; this.removeAllListeners(); this.seen.clear(); this.claims.clear(); }
}
