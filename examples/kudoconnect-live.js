import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createOMConnect } from '../omconnect/index.js';
import { createOMAdapter } from '../adapters/omconnect.js';
import { createCore, planRoute } from '../overmindmc.js';
const mode = process.argv[2] || 'observe';
if (!['observe', 'walk', 'gather'].includes(mode)) throw new Error("Mode: observe, walk or gather.");
const client = createOMConnect({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565), username: process.env.MC_USERNAME || 'Alice', version: '1.21.1', auth: 'offline' });
const report = { startedAt: new Date().toISOString(), mode, status: 'connecting', actions: [] };
let core, adapter;
const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("Game test lime 90 seconds.")), 90000);
process.once('SIGINT', () => controller.abort(new Error("Stopped by the user.")));
client.on('warning', e => console.log("Warning: " + e.message));
try {
  await client.connect(); report.initial = client.snapshot(); console.log(JSON.stringify({ connected: true, state: report.initial.position, health: report.initial.health, inventory: report.initial.inventory }));
  adapter = createOMAdapter(client, { trackedBlocks: ['#logs'], searchRadius: 64 });
  const before = await adapter.observe({ signal: controller.signal });
  report.nearestTrees = before.world.sampledBlocks.slice(0, 8);
  if (mode === 'observe') { report.status = 'passed'; }
  else {
    if (client.state.gameMode !== 0 && client.state.gameMode !== 'survival') throw new Error("Testing for action requires survival.");
    let action;
    if (mode === 'gather') action = { skill: 'gather', args: { block: '#logs', count: 1 } };
    else {
      const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(client.state.position[k])])); let target;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) for (let dy = -2; dy <= 1 && !target; dy++) {
        const p = { x: start.x + dx, y: start.y + dy, z: start.z + dz };
        const route = planRoute({ start, goal: p, getBlock: p => client.world.blockAt(p), maxNodes: 2000, maxDistance: 8, maxDrop: 2 });
        if (route.status === 'planned') target = p;
      }
      if (!target) throw new Error("No short safe route for testing.");
      action = { skill: 'goto', args: { ...target, range: 0 } }; report.target = target;
    }
    core = createCore({ config: { schemaVersion: 4, name: 'OMConnectTest', worldId: 'local-kudoconnect', actionTimeoutMs: 60000, rules: [{ id: 'single', action }] }, adapter });
    core.on('action:finish', r => { report.actions.push(r); console.log(JSON.stringify(r)); });
    const cancel = () => { void core.stop(); }; controller.signal.addEventListener('abort', cancel, { once: true });
    try { const result = await core.tick(); report.status = result.lastResult?.outcome === 'success' ? 'passed' : 'failed'; report.reason = result.lastResult?.detail || result.reason; }
    finally { controller.signal.removeEventListener('abort', cancel); }
  }
} catch (e) { report.status = 'failed'; report.reason = e.message; console.error(e.message); }
finally {
  clearTimeout(timer); await core?.stop(); report.final = client.snapshot(); adapter?.dispose(); await client.close(); report.finishedAt = new Date().toISOString();
  const path = resolve(process.env.MC_REPORT || `data/kudoconnect-${mode}.json`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, reason: report.reason, report: path, metrics: report.final.metrics })); process.exitCode = report.status === 'passed' ? 0 : 1;
}
