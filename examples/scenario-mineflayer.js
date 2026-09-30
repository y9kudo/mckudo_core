// Application example. The kernel never creates a Minecraft connection itself.
import mineflayer from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createCore, createScenario, validateScenario, catalogFromMinecraftData, readJavaDataArchive, createCombatReactor, createEndSafetyReactor, createFoodReactor, MCKUDO } from '../mckudo_core.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
const scenarioFile = process.argv.slice(2).find(s => !s.startsWith('--')) || 'examples/scenarios/first-tools.json';
const scenario = validateScenario(JSON.parse(await readFile(resolve(scenarioFile), 'utf8')));
if (process.argv.includes('--check')) { console.log(`Сценарий корректен: ${scenario.name}, этапов ${scenario.steps.length}.`); }
else await main();
async function main() {
  const minutes = Number(process.env.MC_MINUTES || 10), maxActions = Number(process.env.MC_MAX_ACTIONS || 300);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240 || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 10000) throw new Error('MC_MINUTES: 1–240; MC_MAX_ACTIONS: 1–10000.');
  const reportPath = resolve(process.env.MC_REPORT || 'data/scenario-latest.json');
  const report = { engine: MCKUDO, scenario: scenario.name, startedAt: new Date().toISOString(), status: 'connecting', actions: [], observations: [], protocolWarnings: [] };
  let core, adapter, controller, closing = false, failures = 0, blockedSince = 0, lastStage = '', lastObservationAt = 0;
  const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565), version: process.env.MC_VERSION || '1.21.1',
    auth: process.env.MC_AUTH || 'microsoft', username: process.env.MC_USERNAME || 'MCKudoAgent', viewDistance: 16 });
  bot.loadPlugin(pathfinder.pathfinder);
  const timer = setTimeout(() => { void finish('incomplete', 'Истёк общий бюджет времени.'); }, minutes * 60000);
  // Decode failures must be visible in reports, even when the protocol library logs and drops a packet.
  bot._client.on('state', () => {
    const parser = bot._client.deserializer;
    if (!parser || parser.mckudoObserved) return;
    parser.mckudoObserved = true; const parse = parser.parsePacketBuffer.bind(parser);
    parser.parsePacketBuffer = buffer => {
      try { return parse(buffer); }
      catch (error) { if (report.protocolWarnings.length < 20) report.protocolWarnings.push({ state: bot._client.state, bytes: buffer.length, message: String(error.message).slice(0, 200) }); throw error; }
    };
  });
  async function finish(status, reason) {
    if (closing) return; closing = true; clearTimeout(timer);
    await core?.stop();
    if (adapter && bot.entity && bot.health > 0) {
      try { const o = await adapter.observe({ signal: AbortSignal.timeout(2000) }); report.final = compact(o); } catch { /* Connection may already be closed. */ }
    }
    adapter?.dispose(); report.status = status; report.reason = reason; report.finishedAt = new Date().toISOString(); report.scenarioState = controller?.snapshot() || null;
    report.victoryVerified = Boolean(report.final?.endgame?.dragonDeath?.confirmed && report.final.endgame.dragonDeath.ownDamageConfirmed && report.final.endgame.allInitialCrystalsConfirmed);
    await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status, reason, actions: report.actions.length, state: report.scenarioState, victoryVerified: report.victoryVerified, report: reportPath }));
    bot.quit(); process.exitCode = status === 'completed' ? 0 : 1;
  }
  const compact = o => ({ dimension: o.dimension, self: o.self, inventory: Object.fromEntries(Object.entries(o.inventory).filter(([, n]) => n)), endgame: o.endgame, drops: o.drops, nearbyBlocks: Object.entries(o.world.nearbyBlocks).filter(([, present]) => present).map(([name]) => name) });
  bot.once('spawn', () => { void run().catch(e => finish('failed', e.message)); });
  async function run() {
    await bot.waitForChunksToLoad(); if (closing) return;
    report.minecraft = bot.version; report.mode = bot.game.gameMode;
    if (bot.game.gameMode !== 'survival') return finish('blocked', 'Этот игровой тест требует режима survival.');
    const raw = process.env.MC_DATA_ARCHIVE ? await readJavaDataArchive(process.env.MC_DATA_ARCHIVE) : process.env.MC_DATA_JSON ? JSON.parse(await readFile(process.env.MC_DATA_JSON, 'utf8')) : null;
    const catalog = catalogFromMinecraftData(bot.registry, raw ? { vanillaRecipes: raw.recipes, tags: raw.tags } : {}); report.catalog = catalog.summary();
    const movements = new pathfinder.Movements(bot); movements.canDig = false; movements.allow1by1towers = false; movements.maxDropDown = 2; bot.pathfinder.setMovements(movements);
    const getBlock = p => bot.blockAt(bot.entity.position.offset(p.x - bot.entity.position.x, p.y - bot.entity.position.y, p.z - bot.entity.position.z));
    const stations = {}, base = bot.entity.position.floored();
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (Math.hypot(dx, dz) < 2) continue;
      const p = base.offset(dx, 0, dz);
      if (getBlock(p)?.name !== 'air' || getBlock(p.offset(0, 1, 0))?.name !== 'air' || getBlock(p.offset(0, -1, 0))?.boundingBox !== 'block') continue;
      const name = !stations['minecraft:crafting_table'] ? 'minecraft:crafting_table' : !stations['minecraft:furnace'] ? 'minecraft:furnace' : null;
      if (name) stations[name] = { x: p.x, y: p.y, z: p.z };
    }
    adapter = createMineflayerAdapter(bot, { goals: pathfinder.goals, catalog, searchRadius: 128, entityRadius: 128, requestedViewDistance: 16,
      trackedBlocks: ['#logs', '#ores', '#workstations', '#crops', 'minecraft:stone', 'minecraft:obsidian', 'minecraft:gravel', 'minecraft:nether_portal', 'minecraft:end_portal', 'minecraft:end_portal_frame', 'minecraft:nether_bricks', 'minecraft:nether_brick_fence', 'minecraft:iron_bars'] });
    controller = createScenario({ scenario, catalog, stations, getBlock });
    report.initial = compact(await adapter.observe({ signal: new AbortController().signal }));
    console.log(JSON.stringify({ mode: report.mode, position: report.initial.self.position, inventory: report.initial.inventory, scenario: scenario.name }));
    core = createCore({ config: { schemaVersion: 4, name: 'MCKudoAgent', worldId: process.env.MC_WORLD_ID || 'local-test', tickIntervalMs: 150, actionTimeoutMs: 60000, maxHistory: 100 }, adapter,
      reactors: [createEndSafetyReactor(), createCombatReactor(), createFoodReactor({ catalog, allowHunting: true }), controller.reactor] });
    core.on('action:start', d => { if (d.action.skill === 'gather') console.log(`Добыча: ${d.action.args.block} → ${d.action.args.item}`); report.currentAction = d.action; });
    core.on('action:finish', r => {
      r.action = report.currentAction;
      report.actions.push(r); console.log(`${r.skill}: ${r.outcome} ${r.detail}`);
      if (r.outcome === 'failure') failures++; else if (r.outcome === 'success') failures = 0;
      if (failures >= 3) void finish('failed', 'Три последовательные ошибки действий.');
      if (report.actions.length >= maxActions) void finish('incomplete', 'Достигнут бюджет действий.');
    });
    core.on('state', s => {
      const stage = controller.snapshot();
      if (stage.current !== lastStage) { lastStage = stage.current; console.log(`Этап: ${lastStage || 'завершено'}`); }
      if (stage.status === 'completed') { void finish('completed', stage.reason); return; }
      if (stage.status === 'blocked' && s.status === 'idle') { blockedSince ||= Date.now(); if (Date.now() - blockedSince >= 30000) void finish('blocked', stage.reason); } else blockedSince = 0;
      if (s.observation && Date.now() - lastObservationAt >= 5000) { lastObservationAt = Date.now(); report.observations.push({ at: Date.now(), stage: stage.current, ...compact(s.observation) }); if (report.observations.length > 720) report.observations.shift(); }
    });
    core.start();
  }
  bot.on('death', () => { void finish('failed', 'Агент погиб.'); });
  bot.on('error', e => { void finish('failed', e.message); });
  bot.on('kicked', () => { void finish('failed', 'Сервер отключил агента.'); });
  bot.on('end', () => { void finish('disconnected', 'Соединение завершено.'); });
  process.once('SIGINT', () => { void finish('cancelled', 'Остановлено пользователем.'); });
}
