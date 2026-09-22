import { readFile } from 'node:fs/promises';
import { createCore } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';

const read = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
let now = 0;
const core = createCore({ config: await read('./brain.json'),
  adapter: createSimulator({ inventory: { 'minecraft:bread': 0 } }),
  planning: { operators: await read('./operators.json') }, clock: () => now });
core.on('decision:trace', trace => console.log(`Тик ${trace.tick}: ${trace.selected?.operatorId || trace.selected?.id || 'ожидание'}`));
core.on('action:finish', result => console.log(`  ${result.skill}: ${result.outcome}`));
for (let i = 0; i < 32; i++) {
  now += 1000;
  await core.tick();
  if (core.snapshot().brain.goals.every(g => g.status === 'achieved')) break;
}
const snapshot = core.snapshot();
console.log(JSON.stringify({ brain: snapshot.brain, inventory: snapshot.observation.inventory }, null, 2));
await core.stop();
if (!snapshot.brain.goals.every(g => g.status === 'achieved')) process.exitCode = 1;
