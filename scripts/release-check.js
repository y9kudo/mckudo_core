import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCKUDO } from '../mckudo_core.js';
import { KUDOCONNECT } from '../packages/kudoconnect/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run this check with npm run release:check.');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const metadata = [];
for (const [folder, identity] of [['.', MCKUDO], ['packages/kudoconnect', KUDOCONNECT]]) {
  const directory = resolve(root, folder), pkg = await json(resolve(directory, 'package.json'));
  const lock = await json(resolve(directory, 'package-lock.json'));
  assert.equal(pkg.version, identity.version, `${pkg.name}: runtime version`);
  assert.equal(lock.version, pkg.version, `${pkg.name}: lock version`);
  assert.equal(lock.packages[''].version, pkg.version, `${pkg.name}: root lock version`);
  assert.equal(pkg.author, 'y9kudo'); assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.dependencies.mineflayer, undefined, 'Mineflayer must remain optional.');
  const [pack] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: directory, encoding: 'utf8' }));
  const paths = new Set(pack.files.map(file => file.path));
  for (const path of paths) {
    assert.doesNotMatch(path, /(^|\/)(?:data|node_modules|work|outputs|\.git|world)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:log|tmp|tgz)$|bot-log\.txt$/i, `Private/runtime file: ${path}`);
    if (!/\.(?:js|ts)$/.test(path)) continue;
    const source = await readFile(resolve(directory, path), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
      const target = posix.normalize(posix.join(posix.dirname(path), match[2]));
      assert.ok(paths.has(target), `${pkg.name}: ${path} imports missing packaged file ${target}`);
    }
  }
  // Documentation ships with the package too: broken local links are release failures.
  for (const path of paths) {
    if (!path.endsWith('.md')) continue;
    const source = await readFile(resolve(directory, path), 'utf8');
    for (const match of source.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:[a-z]+:|\/)/i.test(target)) continue;
      assert.ok((await stat(resolve(directory, posix.dirname(path), decodeURIComponent(target))).catch(() => null))?.isFile(), `${pkg.name}: broken link ${path} -> ${target}`);
    }
  }
  metadata.push({ name: pkg.name, version: pkg.version, files: paths.size, bytes: pack.size });
}
assert.equal(metadata[0].version, metadata[1].version, 'Core and bundled client release versions differ.');
console.log(JSON.stringify({ status: 'passed', packages: metadata }, null, 2));
