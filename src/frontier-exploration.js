import { planRouteToAny, isAir, isFullBlock, isHazard } from './navigation.js';

const key = p => `${p.x},${p.y},${p.z}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const rays = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Rank observation positions by occlusion-aware unknown boundaries, risk and recent visits. */
export function frontierCandidates({ position, getBlock, mode = 'surface', visited = [], radius = 24, maxCandidates = 16, candidateCost = () => 0, maxScanCells = 32768 } = {}) {
  if (!position || !['x', 'y', 'z'].every(k => Number.isFinite(position[k]) && Math.abs(position[k]) < 30000000) || typeof getBlock !== 'function' || !['surface', 'ores'].includes(mode) || !Number.isInteger(radius) || radius < 4 || radius > 128 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 64 || !Number.isInteger(maxScanCells) || maxScanCells < 64 || maxScanCells > 100000 || !Array.isArray(visited) || visited.length > 1024 || visited.some(p => !p || !['x', 'y', 'z'].every(k => Number.isFinite(p[k])))) throw new Error('Frontier exploration inputs or budgets are invalid.');
  const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])])), seen = new Set(visited.map(key));
  const candidates = [], cache = new Map(); let scanned = 0;
  const read = p => { const k = key(p); if (!cache.has(k)) cache.set(k, getBlock(p) || null); return cache.get(k); };
  // Concentric squares inspect nearby openings before distant spokes, including diagonal passages.
  scan: for (let r = 2; r <= radius; r += 2) for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = start.x + dx, z = start.z + dz;
    for (let y = start.y + 2; y >= start.y - (mode === 'ores' ? Math.min(24, radius) : 4); y--) {
      if (++scanned > maxScanCells) break scan;
      const p = { x, y, z };
      if (seen.has(key(p)) || !isAir(read(p)) || !isAir(read({ ...p, y: y + 1 })) || !isFullBlock(read({ ...p, y: y - 1 }))) continue;
      let informationGain = 0, risk = 0;
      for (const [rx, rz] of rays) {
        for (let n = 1; n <= 8; n++) {
          const q={ x: x + rx * n, y: y + 1, z: z + rz * n }, bounds=getBlock.bounds;
          if(bounds&&['x','y','z'].some(k=>q[k]<bounds.min[k]||q[k]>=bounds.min[k]+bounds.size[k]))break;
          const b = read(q);
          if (!b) { informationGain += 1 / (1 + n * .25); break; }
          if (!isAir(b)) break; // A solid wall does not reveal the unknown region behind it.
        }
        for (const dy of [-1, 0]) if (isHazard(read({ x: x + rx, y: y + dy, z: z + rz }))) risk++;
      }
      const learned = candidateCost(p);
      if (!Number.isFinite(learned) || learned < 0 || learned > 1000) throw new Error('candidateCost must be finite and within 0–1000.');
      const revisits = visited.slice(-64).reduce((n, v) => n + Math.max(0, 1 - distance(v, p) / 8), 0);
      const score = informationGain * 8 + (mode === 'ores' ? Math.max(-2, start.y - y) * 3 : 0) - distance(start, p) * .25 - risk * 6 - Math.min(30, revisits * 3) - learned;
      candidates.push({ p, score, informationGain, risk });
    }
  }
  candidates.sort((a, b) => b.score - a.score || distance(start, a.p) - distance(start, b.p) || key(a.p).localeCompare(key(b.p)));
  // Limit storage as well as search work. Every returned position still needs a live route.
  return candidates.slice(0, maxCandidates);
}

/** Shared multi-goal A* budgets replace independent full searches for each frontier candidate. */
export function planFrontierExploration(options = {}, ranking) {
  const { position, getBlock, radius = 24, maxNodes = 1500, maxDrop = 3, mode = 'surface' } = options;
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 100000 || !Number.isInteger(maxDrop) || maxDrop < 1 || maxDrop > 32) throw new Error('Frontier route budgets are invalid.');
  if(ranking&&(!Array.isArray(ranking)||ranking.length>64||ranking.some(c=>!c?.p||!['x','y','z'].every(k=>Number.isInteger(c.p[k])&&Math.abs(c.p[k])<=30000000)||!['score','informationGain','risk'].every(k=>Number.isFinite(c[k])))))throw new Error('Frontier ranking is invalid.');
  const candidates = ranking?ranking.map(c=>{const cost=options.candidateCost?.(c.p)??0;if(!Number.isFinite(cost)||cost<0||cost>1000)throw new Error('candidateCost must be finite and within 0–1000.');return {...c,score:c.score-cost};}).sort((a,b)=>b.score-a.score).slice(0,options.maxCandidates??16):frontierCandidates(options);
  const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(position[k])]));
  let visitedNodes = 0, attempts = 0;
  while (candidates.length && visitedNodes < maxNodes) {
    const best = candidates[0].score, group = [];
    while (candidates.length && candidates[0].score >= best - 3) group.push(candidates.shift());
    const remaining = maxNodes - visitedNodes;
    const route = planRouteToAny({ start, goals: group.map(c => c.p), getBlock, maxDistance: radius, maxNodes: remaining, maxDrop, signal: options.signal });
    visitedNodes += route.visited; attempts++;
    if (route.status === 'planned') {
      const chosen = group.find(c => key(c.p) === key(route.selectedGoal));
      return { status: 'planned', reason: mode === 'ores' ? 'Explore an observed cave or lower frontier for resources.' : 'Explore an informative frontier through observed safe terrain.', target: chosen.p, route, attempts,
        frontier: { strategy: 'information-gain', informationGain: chosen.informationGain, risk: chosen.risk, score: chosen.score, visitedNodes, maxNodes } };
    }
  }
  return { status: 'blocked', reason: 'No frontier is reachable within the shared exploration budget.', target: null, attempts,
    frontier: { strategy: 'information-gain', visitedNodes, maxNodes } };
}
