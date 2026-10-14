import { planRoute } from '../overmindmc.js';
// A known corridor with a two-block gap. The kernel only plans; an adapter executes.
const route = planRoute({ start: { x: 0, y: 0, z: 0 }, goal: { x: 3, y: 0, z: 0 }, bridgeBudget: 2,
  getBlock(p) {
    if (p.z !== 0 || p.x < 0 || p.x > 3) return null;
    if (p.y === -1 && (p.x === 0 || p.x === 3)) return { name: 'stone', boundingBox: 'block' };
    if (p.y >= -1 && p.y <= 2) return { name: 'air', boundingBox: 'empty' };
    return null;
  }
});
if (route.status !== 'planned' || route.bridgeUsed !== 2) throw new Error(route.reason);
console.log(JSON.stringify(route, null, 2));
