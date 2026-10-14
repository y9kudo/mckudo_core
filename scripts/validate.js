import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateConfig } from '../overmindmc.js';
const file = resolve(process.argv[2] || 'examples/agent.json');
try {
  const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
  console.log(`JSON valid: ${config.name}, rules: ${config.rules.length}, tasks: ${config.workflows.length}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
