import {mkdir, open, readFile, rename, stat, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const writers = new Map();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const format = 'overmind:transactional-json';

/** Single-process serialized commits. A verified previous generation survives a torn write. */
export function createTransactionalJson(filename, {maxBytes = 1048576, validate = () => {}} = {}) {
  const file = resolve(filename), backup = file + '.bak';
  let diagnostics = {source:'empty', revision:0, recovered:false, legacy:false};
  const read = async path => {
    if ((await stat(path)).size > maxBytes + 1024) throw new Error('Memory exceeds its configured byte limit.');
    const raw = JSON.parse(await readFile(path, 'utf8'));
    const wrapped = raw?.format === format;
    if (wrapped && (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || raw.checksum !== digest(raw.payload))) throw new Error('Memory integrity check failed.');
    const value = wrapped ? raw.payload : raw;
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new Error('Memory exceeds its configured byte limit.');
    validate(value);
    return {value, revision:wrapped ? raw.revision : 0, legacy:!wrapped};
  };
  const readBest = async () => {
    let primaryError;
    try { const r = await read(file); return {...r, source:'primary', recovered:false}; }
    catch (error) { primaryError = error; }
    try { const r = await read(backup); return {...r, source:'backup', recovered:true}; }
    catch (error) {
      if (primaryError.code === 'ENOENT' && error.code === 'ENOENT') return null;
      throw new Error('No valid memory generation. Files were left unchanged.', {cause:primaryError.code === 'ENOENT' ? error : primaryError});
    }
  };
  const atomic = async (target, text) => {
    const temporary = target + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, target);
      // Directory sync is supported on POSIX; Windows rejects opening a directory.
      if (process.platform !== 'win32') { const directory = await open(dirname(target), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  const envelope = (payload, revision) => JSON.stringify({format, version:1, revision, checksum:digest(payload), payload});
  return {
    async load() {
      await writers.get(file)?.catch(() => {});
      const r = await readBest();
      diagnostics = r ? {source:r.source, revision:r.revision, recovered:r.recovered, legacy:r.legacy} : {source:'empty', revision:0, recovered:false, legacy:false};
      return r?.value;
    },
    save(value) {
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > maxBytes) throw new Error('Memory exceeds its configured byte limit.');
      const payload = JSON.parse(text); validate(payload);
      const job = (writers.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
        await mkdir(dirname(file), {recursive:true});
        const previous = await readBest(), revision = (previous?.revision || 0) + 1;
        if (previous) await atomic(backup, envelope(previous.value, Math.max(1, previous.revision)));
        await atomic(file, envelope(payload, revision));
        diagnostics = {source:'primary', revision, recovered:false, legacy:false};
      });
      writers.set(file, job);
      void job.finally(() => { if (writers.get(file) === job) writers.delete(file); }).catch(() => {});
      return job;
    },
    diagnostics:() => ({...diagnostics}),
    flush:() => writers.get(file) || Promise.resolve()
  };
}
