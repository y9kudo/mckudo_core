import { createFleet } from '../index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const count = Number(process.env.MC_AGENTS || 2), fleet = createFleet({ count, connection: { host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565), version: '1.21.1', auth: 'offline', connectTimeoutMs: 10000, viewDistance: 8 } });
const report = { startedAt: new Date().toISOString(), count, status: 'running', messages: [], states: {}, chatPackets: 0 };
const timer = setTimeout(() => { report.reason = 'Лимит теста 90 секунд.'; void fleet.close(); }, 90000);
process.once('SIGINT', () => { void fleet.close(); });
try {
  for (const [name, c] of fleet.agents) {
    c.on('warning', e => console.log(`${name}: ${e.message}`));
    fleet.peers.get(name).on('message', e => { if (e.topic !== 'intent') report.messages.push({ receivedBy: name, ...e }); });
  }
  await fleet.connect();
  for (const [name, c] of fleet.agents) {
    const write = c.client.write.bind(c.client); c.client.write = (packet, data) => { if (/chat|command/.test(packet)) report.chatPackets++; return write(packet, data); };
    const o = c.observe();
    if (o.version !== 1 || o.self.health === null || o.world.loadedChunks < 1) throw new Error(`${name}: нет подтверждённого наблюдения.`);
    const trees = await c.world.findBlocks({ classes: ['#logs'], position: c.state.position, radius: 32, count: 3 });
    fleet.peers.get(name).send('discovery', { dimension: o.world.dimension, nearestLogs: trees.blocks });
    fleet.peers.get(name).claim('test/shared-tree', { bid: 1 });
    report.states[name] = { status: c.state.status, position: c.state.position, health: c.state.health, loadedChunks: o.world.loadedChunks, nearestLogs: trees.blocks };
  }
  await delay(500);
  report.owners = [...fleet.peers.values()].map(p => p.owner('test/shared-tree'));
  if (new Set(report.owners).size !== 1 || report.owners[0] !== 'Alice' || report.chatPackets !== 0 || report.messages.length !== count * count) throw new Error('Проверка обмена/согласования не прошла.');
  report.final = fleet.snapshot(); report.status = 'passed'; console.log(JSON.stringify({ status: report.status, count, names: [...fleet.agents.keys()], owner: report.owners[0], delivered: report.messages.length, chatPackets: report.chatPackets }));
} catch (e) { report.status = 'failed'; report.reason = e.message; console.error(e.message); }
finally {
  clearTimeout(timer); await fleet.close(); report.finishedAt = new Date().toISOString();
  const path = resolve(process.env.MC_REPORT || `data/kudoconnect-team-${count}.json`); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2));
  console.log('Report: ' + path); process.exitCode = report.status === 'passed' ? 0 : 1;
}
