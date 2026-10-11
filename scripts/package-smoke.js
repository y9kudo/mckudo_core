import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package.');
const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'mckudo-package-'));
const run = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
try {
  const archives = [];
  for (const folder of [root, join(root, 'packages/kudoconnect')]) {
    const [pack] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], folder));
    archives.push(join(directory, pack.filename));
  }
  const consumer = join(directory, 'consumer'); await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const cacheMode = process.argv.includes('--offline') ? '--offline' : '--prefer-offline';
  run(['install', cacheMode, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', ...archives], consumer);
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {MCKUDO, createMinecraftAgent, defineMission, createNeuralPlanner, createCpuPool, catalogFromMinecraftData} from 'mckudo';
    import {createKudoConnect, KUDOCONNECT} from 'kudoconnect';
    import {KUDOCONNECT as bundled} from 'mckudo/connect';
    import {createKudoAdapter} from 'mckudo/adapters/kudoconnect';
    import {createSimulator} from 'mckudo/adapters/simulator';
    const require = createRequire(import.meta.url);
    assert.throws(()=>require.resolve('mineflayer'), {code:'MODULE_NOT_FOUND'});
    assert.equal(MCKUDO.version, ${JSON.stringify(version)});
    assert.equal(KUDOCONNECT.version, MCKUDO.version); assert.equal(bundled.version, MCKUDO.version);
    const client = createKudoConnect({username:'Atlas'});
    assert.equal(client.dataLoaded, false);
    assert.ok(catalogFromMinecraftData(client.registry).blocks().length > 1000);
    assert.equal(typeof createKudoAdapter, 'function'); assert.equal(typeof createSimulator, 'function');
    assert.equal(defineMission([{get:'#logs',count:2}]).steps[0].targets['#logs'], 2);
    const model = createNeuralPlanner({worldId:'package-smoke'});
    assert.equal(createNeuralPlanner({worldId:'package-smoke',memory:model.export()}).snapshot().samples, 0);
    const pool = createCpuPool();
    try { await assert.rejects(pool.run({type:'unknown'}), /Неизвестная задача CPU/); } finally { await pool.close(); }
    const agent = createMinecraftAgent({worldId:'package-smoke'}); await agent.close(); await client.close();
    console.log('Installed packages passed: imports, optional Mineflayer, lazy registry, mission, memory, CPU worker and shutdown.');
  `], { cwd: consumer, encoding: 'utf8', timeout: 30000 });
  console.log(output.trim());
} finally {
  const target = relative(base, resolve(directory));
  assert.ok(target && !target.startsWith('..') && !isAbsolute(target), 'Temporary cleanup escaped its root.');
  await rm(directory, { recursive: true, force: true });
}
