#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createCore, validateConfig, MCKUDO } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';

const [command = 'help', ...args] = process.argv.slice(2);
const readConfig = async file => validateConfig(JSON.parse(await readFile(resolve(file), 'utf8')));
try {
  if (command === 'validate') {
    if (args.length > 1) throw new Error('Использование: mckudo validate [agent.json]');
    const config = await readConfig(args[0] || 'agent.json');
    console.log(`JSON корректен: ${config.name}; правил ${config.rules.length}, задач ${config.workflows.length}, целей ${config.goals.length}.`);
  } else if (command === 'simulate') {
    const file = args[0] || 'agent.json';
    if (args.length > 1 && (args[1] !== '--steps' || args.length !== 3)) throw new Error('Использование: mckudo simulate agent.json --steps 20');
    const steps = Number(args[2] ?? 20);
    if (!Number.isInteger(steps) || steps < 1 || steps > 1000) throw new Error('steps: целое число 1–1000.');
    const core = createCore({ config: await readConfig(file), adapter: createSimulator() });
    core.on('action:finish', result => console.log(`${result.rule}: ${result.outcome}`));
    for (let n = 0; n < steps; n++) await core.tick();
    const state = core.snapshot();
    console.log(JSON.stringify({ name: state.name, status: state.status, reason: state.reason, workflows: state.workflows, observation: state.observation }, null, 2));
    await core.stop();
    if (['fault', 'blocked'].includes(state.status)) process.exitCode = 2;
  } else if (command === 'init') {
    if (args.length !== 1) throw new Error('Использование: mckudo init путь-к-новой-папке');
    const dir = resolve(args[0]);
    const exists = await stat(dir).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (exists) throw new Error('Папка уже существует. Выбери новую папку; существующие файлы не перезаписываются.');
    const config = JSON.parse(await readFile(new URL('../examples/workshop.json', import.meta.url), 'utf8'));
    config.$schema = './node_modules/mckudo/schemas/agent.schema.json'; config.worldId = 'my-workshop';
    await mkdir(dir, { recursive: false });
    await writeFile(join(dir, 'agent.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'mckudo-workspace', private: true, type: 'module', scripts: { start: 'node index.js' } }, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(dir, 'index.js'), `import { readFile } from 'node:fs/promises';
import { createCore } from 'mckudo';
import { createSimulator } from 'mckudo/adapters/simulator';
const config = JSON.parse(await readFile(new URL('./agent.json', import.meta.url), 'utf8'));
const core = createCore({ config, adapter: createSimulator() });
core.on('action:finish', r => console.log(r.rule, r.outcome));
for (let n = 0; n < 20; n++) await core.tick();
console.log(core.snapshot().workflows);
await core.stop();
`, { flag: 'wx' });
    console.log(`Проект создан: ${dir}\nУстанови в него локальный пакет mckudo (.tgz или папку), затем выполни npm start. Пример использует симулятор.`);
  } else if (['help', '--help', '-h'].includes(command)) {
    console.log(`${MCKUDO.name} ${MCKUDO.version} · разработано ${MCKUDO.author}\nmckudo init <новая-папка>\nmckudo validate [agent.json]\nmckudo simulate [agent.json] [--steps 20]`);
  } else throw new Error(`Неизвестная команда: ${command}. Используй mckudo help.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
