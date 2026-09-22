// External dependencies belong to the application. Target: vanilla Java 1.21.1.
import mineflayer from 'mineflayer';
import pathfinder from 'mineflayer-pathfinder';
import { readFile } from 'node:fs/promises';
import { createCore } from '../mckudo_core.js';
import { createMineflayerAdapter } from '../adapters/mineflayer.js';

const read = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const config = await read('./brain.json'), operators = await read('./operators.json');
const bot = mineflayer.createBot({ host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'MCKudoAgent', auth: process.env.MC_AUTH || 'microsoft', version: process.env.MC_VERSION || '1.21.1' });
bot.loadPlugin(pathfinder.pathfinder);
let core, completed = false;
bot.once('spawn', () => { void start().catch(error => { console.error(error.message); bot.quit(); }); });
async function start() {
  await bot.waitForChunksToLoad();
  const movements = new pathfinder.Movements(bot);
  movements.canDig = false; movements.allow1by1towers = false; movements.maxDropDown = 2;
  bot.pathfinder.setMovements(movements);
  core = createCore({ config, adapter: createMineflayerAdapter(bot, { goals: pathfinder.goals }), planning: { operators } });
  core.on('decision:trace', trace => console.log(JSON.stringify(trace)));
  core.on('action:finish', result => console.log(JSON.stringify(result)));
  core.on('state', state => {
    if (!completed && state.brain.goals.every(g => g.status === 'achieved')) {
      completed = true;
      console.log('Цель подтверждена инвентарём:', state.observation.inventory);
      // Never await stop() inside an executing tick's callback.
      void core.stop();
    }
  });
  core.start();
}
bot.on('death', () => { void core?.pause(); });
bot.on('end', () => { void core?.stop(); });
bot.on('kicked', reason => console.error('Отключён:', reason));
bot.on('error', error => console.error(error.message));
process.once('SIGINT', async () => { await core?.stop(); bot.quit(); });
