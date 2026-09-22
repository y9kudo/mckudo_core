import { readFile } from 'node:fs/promises';
const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (p.license !== 'MIT' || !p.repository?.url) {
  console.error('Перед публикацией npm добавь проверенный URL GitHub-репозитория в package.json и проверь право на имя пакета. Локальная установка из папки или .tgz уже доступна.');
  process.exitCode = 1;
}
