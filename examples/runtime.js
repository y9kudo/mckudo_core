import { readFile } from 'node:fs/promises';
import { createCore, MckudoRuntime } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';
const config = JSON.parse(await readFile(new URL('./workshop.json', import.meta.url), 'utf8'));
const runtime = new MckudoRuntime({ concurrency: 2 });
for (const name of ['NorthWorkshop', 'SouthWorkshop', 'HarborWorkshop']) {
  runtime.add(name, createCore({ config: { ...config, name, worldId: name }, adapter: createSimulator() }), { resourceKey: 'simulator:' + name });
}
for (let step = 0; step < 8; step++) await runtime.tick();
for (const [name, state] of Object.entries(runtime.snapshot().agents)) console.log(name, state.workflows[0].status);
await runtime.stop();
