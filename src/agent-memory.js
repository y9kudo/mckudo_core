import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {createTransactionalJson} from './transactional-json.js';

/** World/agent isolation, beta1 import, checksummed commits and one previous generation. */
export function createAgentMemory(directory, worldId, {maxBytes = 2 * 1024 * 1024} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) throw new Error('Agent memory maxBytes must be 1 KiB–16 MiB.');
  if (typeof worldId !== 'string' || !worldId.length || worldId.length > 1000) throw new Error('A bounded worldId is required.');
  const root = join(resolve(directory), createHash('sha256').update(worldId).digest('hex').slice(0,24)), stores = new Map();
  const store = (name, taskMemory = false) => {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new Error('Invalid agent memory name.');
    const key = name + (taskMemory ? '.tasks' : '');
    if (!stores.has(key)) stores.set(key, createTransactionalJson(join(root, key + '.json'), {maxBytes:taskMemory ? Math.min(maxBytes, 1048576) : maxBytes, validate:value => {
      if (value?.schemaVersion !== 1 || value.worldId !== worldId || value.name !== name) throw new Error('Memory belongs to another world/agent or an unsupported schema.');
      if (taskMemory && (!Array.isArray(value.tasks) || value.tasks.length > 32)) throw new Error('Invalid task memory.');
    }}));
    return stores.get(key);
  };
  return {
    async load(name) { return await store(name).load() ?? null; },
    save(name, state) { return store(name).save({...state, schemaVersion:1, worldId, name}); },
    async loadTasks(name) { return await store(name, true).load() ?? null; },
    saveTasks(name, state) { return store(name, true).save({...state, schemaVersion:1, worldId, name}); },
    diagnostics:name => store(name).diagnostics(),
    async flush() { await Promise.all([...stores.values()].map(s => s.flush())); }
  };
}
