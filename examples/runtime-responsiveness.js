/** Offline benchmark: real A* computations, synthetic world, no Minecraft connections. */
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { planRoute, planRouteAsync } from '../kudoconnect/index.js';

const count = Number(process.env.MC_COUNT || 20);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('MC_COUNT: 1–20.');
const stone = { name: 'stone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] };
const air = { name: 'air', boundingBox: 'empty', shapes: [] };
const options = { start: { x: 0, y: 1, z: 0 }, goal: { x: 300, y: 1, z: 0 }, getBlock: p => p.y < 1 ? stone : air, maxNodes: 1500, maxDrop: 16 };

async function measure(name, search) {
  let last = performance.now(), gaps = [], ticksDuringSearch = 0, active = false;
  const timer = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; if (active) ticksDuringSearch++; }, 20);
  await delay(40); gaps = []; last = performance.now();
  const cpu = process.cpuUsage(), began = performance.now();
  let results, durationMs, usage;
  try {
    active = true; results = await Promise.all(Array.from({ length: count }, () => search(options)));
    durationMs = performance.now() - began; usage = process.cpuUsage(cpu); active = false;
    await delay(40);
  } finally { active = false; clearInterval(timer); }
  return { name, jobs: count, visited: results.reduce((n, r) => n + r.visited, 0), statuses: [...new Set(results.map(r => r.status))],
    durationMs, cpuMs: (usage.user + usage.system) / 1000, ticksDuringSearch, maxHeartbeatGapMs: Math.max(...gaps), rssMiB: process.memoryUsage().rss / 1048576 };
}

planRoute({ ...options, maxNodes: 100 });
const sync = await measure('synchronous', planRoute);
const sliced = await measure('cooperative', planRouteAsync);
const report = { kind: 'offline-scheduler-benchmark', at: new Date().toISOString(), node: process.version, world: 'synthetic flat world, unreachable target', sync, sliced,
  equalWork: sync.visited === sliced.visited && JSON.stringify(sync.statuses) === JSON.stringify(sliced.statuses) };
await mkdir('data', { recursive: true });
await writeFile('data/runtime-responsiveness.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.equalWork || sliced.ticksDuringSearch === 0) process.exitCode = 1;
