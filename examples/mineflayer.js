// Install mineflayer and mineflayer-pathfinder in YOUR application before using this example.
import mineflayer from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { readFile } from 'node:fs/promises';
import { createCore } from '../mckudo_core.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';
const config = JSON.parse(await readFile(new URL('./agent.json', import.meta.url), 'utf8'));
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'MCKudoAgent', auth: process.env.MC_AUTH || 'offline', version: process.env.MC_VERSION || false });
bot.loadPlugin(pathfinder.pathfinder);
let core;
bot.once('spawn', () => {
  const movements = new pathfinder.Movements(bot);
  movements.canDig = false; movements.allow1by1towers = false; movements.maxDropDown = 2;
  bot.pathfinder.setMovements(movements);
  core = createCore({ config, adapter: createMineflayerAdapter(bot, { goals: pathfinder.goals }) });
  core.on('action:finish', console.log); core.start();
});
bot.on('death', () => { void core?.pause(); });
bot.on('end', () => { void core?.stop(); });
bot.on('error', error => console.error(error.message));
process.once('SIGINT', async () => { await core?.stop(); bot.quit(); });
