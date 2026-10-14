import { readFile } from 'node:fs/promises';
import { createCore, OVERMIND } from '../overmindmc.js';
import { createSimulator } from '../adapters/simulator.js';
const config = JSON.parse(await readFile(new URL('./agent.json', import.meta.url), 'utf8'));
const core = createCore({ config, adapter: createSimulator() });
console.log(`${OVERMIND.name} ${OVERMIND.version} · developed by ${OVERMIND.author}
Simulation without connection Minecraft.
`);
core.on('action:finish', r => console.log(`${r.rule}: ${r.outcome}`));
for (let n = 0; n < 7; n++) await core.tick();
console.log(JSON.stringify(core.snapshot(), null, 2));
await core.stop();
