// An application using the library. Connection lifecycle belongs here, never inside the kernel.
import mineflayer from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { readFile } from 'node:fs/promises';
import { createCore, catalogFromMinecraftData, readJavaDataArchive, createBlockTaxonomy, createResourceReactor, createDefenseReactor, createFoodReactor } from '../overmindmc.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
const vision = JSON.parse(await readFile(new URL('./perception.json', import.meta.url), 'utf8'));
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565), username: process.env.MC_USERNAME || 'OvermindMCAgent',
  version: process.env.MC_VERSION || '1.21.1', auth: process.env.MC_AUTH || 'microsoft', viewDistance: vision.requestedViewDistance });
bot.loadPlugin(pathfinder.pathfinder);
let core, adapter, closing = false;
const timeout = setTimeout(() => { void finish("Expired 5 scenario minutes."); }, 300000);
async function finish(reason) { if (closing) return; closing = true; clearTimeout(timeout); console.log(reason); await core?.stop(); adapter?.dispose(); bot.quit(); }
bot.once('spawn', () => { void run().catch(e => finish(e.message)); });
async function run() {
  await bot.waitForChunksToLoad(); if (closing) return;
  const raw = process.env.MC_DATA_ARCHIVE ? await readJavaDataArchive(process.env.MC_DATA_ARCHIVE) : null;
  if (closing) return;
  const catalog = catalogFromMinecraftData(bot.registry, raw ? { vanillaRecipes: raw.recipes, tags: raw.tags } : {});
  const taxonomy = createBlockTaxonomy(catalog, raw ? { tags: raw.blockTags } : {});
  const moves = new pathfinder.Movements(bot); moves.canDig = false; moves.allow1by1towers = false; moves.maxDropDown = 2; bot.pathfinder.setMovements(moves);
  const base = bot.entity.position.floored(), stations = {};
  for (let dx = -3; dx <= 3 && !stations['minecraft:crafting_table']; dx++) for (let dz = -3; dz <= 3; dz++) {
    if (Math.hypot(dx, dz) < 2) continue;
    const p = base.offset(dx, 0, dz);
    if (bot.blockAt(p)?.name === 'air' && bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' && bot.blockAt(p.offset(0, 1, 0))?.name === 'air') { stations['minecraft:crafting_table'] = { x: p.x, y: p.y, z: p.z }; break; }
  }
  adapter = createMineflayerAdapter(bot, { goals: pathfinder.goals, catalog, taxonomy, ...vision });
  const getBlock = p => bot.blockAt(bot.entity.position.offset(p.x - bot.entity.position.x, p.y - bot.entity.position.y, p.z - bot.entity.position.z));
  core = createCore({ config: { schemaVersion: 4, name: 'ResourceExample', worldId: 'local-resources', actionTimeoutMs: 60000 }, adapter,
    reactors: [createDefenseReactor(), createFoodReactor({ catalog, allowHunting: true }), createResourceReactor({ catalog, taxonomy, targets: { 'minecraft:wooden_pickaxe': 1 }, stations, exploration: { getBlock, mode: 'surface', radius: 32 } })] });
  let failures = 0;
  core.on('action:finish', result => { console.log(`${result.skill}: ${result.outcome} ${result.detail}`); if (result.outcome === 'failure' && ++failures >= 3) void finish("Three mistakes: see the reasons above."); });
  core.on('state', state => { if (state.observation?.inventory?.['minecraft:wooden_pickaxe'] >= 1) void finish("Goal confirmed by inventory: wooden pick."); });
  core.start();
}
bot.on('death', () => { void finish("Agent died; scenario completed."); });
bot.on('error', e => { void finish(e.message); });
bot.on('kicked', () => { void finish("Server disconnected the client."); });
bot.on('end', () => { void finish("Connection closed."); });
process.once('SIGINT', () => { void finish("Stopped by the user."); });
