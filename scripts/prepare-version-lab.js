import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const DEFAULT_VERSIONS = ['1.8.8', '1.12.2', '1.16.5', '1.18.2', '1.20.4', '1.21.1', '26.3'];
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Expected --name=value, got ${arg}`);
  return [match[1], match[2]];
}));
if (args['accept-eula'] !== 'true') throw new Error('Set --accept-eula=true only after accepting the Minecraft EULA.');
const versions = (args.versions || DEFAULT_VERSIONS.join(',')).split(',');
if (!versions.length || versions.length > 16 || versions.some(v => !/^[a-zA-Z0-9._-]{1,32}$/.test(v))) throw new Error('Invalid version list.');
const basePort = Number(args.port || 25570);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort + versions.length > 65535) throw new Error('Invalid starting port.');
const root = resolve(args.dir || '../overmind_version_lab');
await mkdir(root, { recursive: true });

async function officialBytes(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['piston-meta.mojang.com', 'piston-data.mojang.com', 'launcher.mojang.com'].includes(parsed.hostname)) throw new Error(`Unexpected download host: ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  return response;
}
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const manifest = await (await officialBytes(MANIFEST)).json();
for (const [index, version] of versions.entries()) {
  const entry = manifest.versions.find(v => v.id === version && v.type === 'release');
  if (!entry) throw new Error(`No official release metadata for ${version}`);
  const metadataBytes = Buffer.from(await (await officialBytes(entry.url)).arrayBuffer());
  if (sha1(metadataBytes) !== entry.sha1) throw new Error(`Metadata SHA-1 mismatch: ${version}`);
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  if (!metadata.downloads?.server?.url || !metadata.downloads.server.sha1) throw new Error(`No official server JAR: ${version}`);
  const directory = join(root, version), jar = join(directory, 'server.jar');
  await mkdir(directory, { recursive: true });
  let existing = null;
  try { existing = await readFile(jar); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!existing || sha1(existing) !== metadata.downloads.server.sha1) {
    const response = await officialBytes(metadata.downloads.server.url), temporary = join(directory, 'server.jar.part');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const downloaded = await readFile(temporary);
    if (sha1(downloaded) !== metadata.downloads.server.sha1) throw new Error(`Server SHA-1 mismatch: ${version}`);
    await rename(temporary, jar);
  }
  const port = basePort + index;
  const properties = `server-ip=127.0.0.1\nserver-port=${port}\nonline-mode=false\nmax-players=4\nspawn-protection=0\ndifficulty=peaceful\ngamemode=survival\nlevel-name=world\nlevel-seed=20261015\nmotd=OvermindMC version lab ${version}\n`;
  for (const [file, contents] of [['server.properties', properties], ['eula.txt', 'eula=true\n']]) {
    try { await writeFile(join(directory, file), contents, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  console.log(JSON.stringify({ version, port, directory, serverSha1: metadata.downloads.server.sha1 }));
}
