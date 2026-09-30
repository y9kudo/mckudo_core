import { KudoConnect } from './client.js';
import { KudoPeer } from './peers.js';
export const DEFAULT_AGENT_NAMES = Object.freeze(['Alice', 'Blake', 'Charlie', 'Dylan', 'Ella', 'Finn', 'Grace', 'Henry', 'Ivy', 'Jack']);

/** Lifecycle and in-process transport. Every client retains its own authoritative world view. */
export function createFleet({ count = 1, names = DEFAULT_AGENT_NAMES.slice(0, count), connection = {}, team = 'local', createClient = options => new KudoConnect(options), settleMs = 100 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10 || !Array.isArray(names) || names.length !== count || new Set(names.map(n => String(n).toLowerCase())).size !== count || names.some(n => !/^[A-Za-z0-9_]{1,16}$/.test(n))) throw new Error('Fleet: 1–10 агентов с уникальными Minecraft-именами латиницей.');
  const agents = new Map(), peers = new Map(); let connecting, closed = false, started = false;
  try {
    for (const name of names) {
      agents.set(name, createClient({ ...connection, username: name }));
      agents.get(name).managedNames = new Set(names.map(n => n.toLowerCase()));
      peers.set(name, new KudoPeer({ id: name, team, peers: names, settleMs, send: envelope => {
        for (const [id, peer] of peers) if (id !== name && (envelope.to === null || envelope.to === id)) peer.receive(envelope);
      } }));
    }
  } catch (error) { for (const p of peers.values()) p.close(); throw error; }
  const stopClients = () => Promise.allSettled([...agents.values()].map(c => c.close()));
  return {
    agents, peers,
    connect() {
      if (started || closed) return Promise.reject(new Error('Fleet: экземпляр используется для одной сессии.'));
      started = true;
      connecting = (async () => {
        try { for (const client of agents.values()) { if (closed) throw new Error('Fleet закрыт.'); await client.connect(); } if (closed) throw new Error('Fleet закрыт.'); return this; }
        catch (error) { closed = true; await stopClients(); for (const p of peers.values()) p.close(); throw error; }
      })(); return connecting;
    },
    snapshot() { return Object.fromEntries([...agents].map(([name, client]) => [name, { agent: client.snapshot(), peer: peers.get(name).snapshot() }])); },
    async close() { closed = true; await stopClients(); await connecting?.catch(() => {}); for (const p of peers.values()) p.close(); }
  };
}
