import { planRoute, isAir, isFullBlock } from './navigation.js';
import { resourceSources, createBlockTaxonomy } from './taxonomy.js';
import { planResourceClasses } from './resources.js';
const key = p => `${p.x},${p.y},${p.z}`;

/** Choose reachable observation points. Ore exploration prefers accessible lower terrain/caves. */
export function explorationCandidates({ position, getBlock, mode = 'surface', visited = [], radius = 32, maxCandidates = 16, maxNodes = 1500, candidateCost = () => 0 }) {
  if (!position || !['x', 'y', 'z'].every(k => Number.isFinite(position[k])) || typeof getBlock !== 'function' || !['surface', 'ores'].includes(mode)) throw new Error("Research: requires position, getBlock and mode surface/ores.");
  if (!Number.isInteger(radius) || radius < 4 || radius > 128 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 64 || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000 || !Array.isArray(visited) || visited.length > 1024) throw new Error("Wrong research budgets.");
  const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])])), seen = new Set(visited.map(key)), candidates = [];
  for (let r = 4; r <= radius; r += 4) for (let i = 0; i < 16; i++) {
    const x = start.x + Math.round(Math.cos(i * Math.PI / 8) * r), z = start.z + Math.round(Math.sin(i * Math.PI / 8) * r);
    for (let y = start.y + 2; y >= start.y - (mode === 'ores' ? Math.min(24, radius) : 4); y--) {
      const p = { x, y, z };
      if (seen.has(key(p)) || !isAir(getBlock(p)) || !isAir(getBlock({ ...p, y: y + 1 })) || !isFullBlock(getBlock({ ...p, y: y - 1 }))) continue;
      const frontier = [[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dz]) => !getBlock({ x: x + dx, y, z: z + dz }));
      const learned = candidateCost(p);if(!Number.isFinite(learned)||learned<0||learned>1000)throw new Error("candidateCost: number 0–1000.");
      const revisits = visited.slice(-64).reduce((n,v)=>n+Math.max(0,1-Math.hypot(v.x-x,v.y-y,v.z-z)/8),0);
      const score = (frontier ? 20 : 0) + (mode === 'ores' ? (start.y - y) * 3 : 0) - r * 0.2 - Math.min(30,revisits*3) - learned;
      candidates.push({ p, score });
    }
  }
  return [...new Map(candidates.sort((a, b) => b.score - a.score).map(c => [key(c.p), c])).values()].slice(0, maxCandidates);
}

export function planExploration(options) {
  const { position, getBlock, mode = 'surface', radius = 32, maxNodes = 1500 } = options;
  const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])])), unique = explorationCandidates(options);
  let attempts = 0;
  for (const c of unique) {
    attempts++;
    const route = planRoute({ start, goal: c.p, getBlock, maxDistance: radius, maxNodes });
    if (route.status === 'planned') return { status: 'planned', reason: mode === 'ores' ? "Research an accessible grove or a new area for ore exploration." : "Increase the observed area.", target: c.p, route, attempts };
  }
  return { status: 'blocked', reason: "No new, achievable observation point in the search budget.", target: null, attempts };
}

/** Replans from fresh inventory/sources after each action; the application still owns the client. */
export function createResourceReactor({ catalog, targets, taxonomy = createBlockTaxonomy(catalog), stations = {}, priority = 10, exploration, maxNodes = 3000 }) {
  const visited = [];
  return { id: 'overmind:resources', apiVersion: 1,
    react(o) {
      if (o.self?.position) {
        const here = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(o.self.position[k])]));
        if (!visited.some(p => key(p) === key(here))) { visited.push(here); if (visited.length > 256) visited.shift(); }
      }
      const availableBlocks = Object.entries(o.world?.nearbyBlocks || {}).filter(([, present]) => present === true).map(([name]) => name);
      const currentStations = { ...stations, ...Object.fromEntries(availableBlocks.filter(n => taxonomy.has(n, 'workstations')).map(n => [n, true])) };
      const sources = resourceSources(catalog, { taxonomy, availableBlocks }).map(source => {
        const distances = (o.world?.sampledBlocks || []).filter(b => b.name === source.block && b.position && o.self?.position)
          .map(b => Math.hypot(b.position.x - o.self.position.x, b.position.y - o.self.position.y, b.position.z - o.self.position.z));
        return distances.length ? { ...source, distance: Math.min(...distances) } : source;
      });
      const plan = planResourceClasses({ catalog, taxonomy, targets, inventory: o.inventory || {}, sources, stations: currentStations, maxNodes });
      if (plan.status === 'planned') return plan.actions.length ? { action: plan.actions[0].action, priority, reason: "Next action for resource purpose at present status." } : { action: null, reason: "Resource objective achieved." };
      if (exploration && o.self?.position) {
        const route = planExploration({ ...exploration, position: o.self.position, visited });
        if (route.status === 'planned') {
          return { action: { skill: 'navigate', args: { ...route.target } }, priority, reason: route.reason };
        }
      }
      return { action: null, reason: plan.reason };
    }
  };
}
