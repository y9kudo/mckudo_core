import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonCopy } from './config.js';
export class FileMemory {
  constructor(file) { this.file = resolve(file); }
  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error('Не удалось прочитать память. Файл оставлен без изменений.', { cause: error }); }
  }
  async save(memory) {
    const data = jsonCopy(memory, '$', 1048576), temporary = this.file + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(this.file), { recursive: true });
    try { await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 }); await rename(temporary, this.file); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
