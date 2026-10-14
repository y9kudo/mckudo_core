import { readFile } from 'node:fs/promises';
const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (p.license !== 'MIT' || !p.repository?.url) {
  console.error("Before publication npm Add a checked URL GitHub-Repository in package.json And check the package name. Local setup from folder or .tgz already available.");
  process.exitCode = 1;
}
