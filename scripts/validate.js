import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateConfig } from '../mckudo_core.js';
const file = resolve(process.argv[2] || 'examples/agent.json');
try {
  const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
  console.log(`JSON корректен: ${config.name}, правил: ${config.rules.length}, задач: ${config.workflows.length}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
