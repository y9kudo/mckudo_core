import {resolve} from 'node:path';
import {jsonCopy} from './config.js';
import {createTransactionalJson} from './transactional-json.js';

export class FileMemory {
  constructor(file) { this.file = resolve(file); this.store = createTransactionalJson(this.file); }
  load() { return this.store.load(); }
  save(memory) { return this.store.save(jsonCopy(memory, '$', 1048576)); }
  diagnostics() { return this.store.diagnostics(); }
}
