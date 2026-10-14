import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/** Read only JSON data entries. No archive paths are extracted to disk and no game code runs. */
export async function readJavaDataArchive(path) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    if (size < 22 || size > 128 * 1024 * 1024) throw new Error("Data archive: size from 22 Byte to 128 MiB.");
    return parseJavaDataArchive(await file.readFile());
  } finally { await file.close(); }
}

export function parseJavaDataArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22 || bytes.length > 128 * 1024 * 1024) throw new Error("Requires ZIP/JAR Buffer to 128 MiB.");
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error("No End Found ZIP-archives.");
  const entries = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), offset = bytes.readUInt32LE(end + 16);
  if (entries === 65535 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || offset + directorySize > end) throw new Error("ZIP64, Multi-volume or damaged archive not supported.");
  const result = { recipes: {}, tags: {}, blockTags: {} }; let cursor = offset, total = 0;
  for (let n = 0; n < entries; n++) {
    if (cursor + 46 > offset + directorySize || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Catalog damaged ZIP.");
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    if (cursor + 46 + nameLength + extraLength + commentLength > offset + directorySize) throw new Error("Path damaged ZIP.");
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const match = /^data\/([a-z0-9_.-]+)\/(recipe|recipes|tags\/item|tags\/items|tags\/block|tags\/blocks)\/([a-z0-9_./-]+)\.json$/.exec(name);
    if (match && !match[3].split('/').includes('..')) {
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), uncompressed = bytes.readUInt32LE(cursor + 24), local = bytes.readUInt32LE(cursor + 42);
      if (flags & 1 || ![0, 8].includes(method) || uncompressed > 2 * 1024 * 1024 || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("Unsupported or damaged data entry.");
      total += uncompressed; if (total > 64 * 1024 * 1024) throw new Error("Too big a data set.");
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > offset) throw new Error("Recording goes beyond borders ZIP.");
      const packed = bytes.subarray(start, start + compressed), raw = method === 8 ? inflateRawSync(packed, { maxOutputLength: 2 * 1024 * 1024 }) : packed;
      if (raw.length !== uncompressed) throw new Error("The size of the data entry is not consistent.");
      const group = match[2].startsWith('tags/item') ? result.tags : match[2].startsWith('tags/block') ? result.blockTags : result.recipes;
      const id = `${match[1]}:${match[3]}`;
      if (Object.hasOwn(group, id)) throw new Error(`Replay ${id}.`);
      group[id] = JSON.parse(raw.toString('utf8'));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!Object.keys(result.recipes).length) throw new Error("Not in the archive data/<namespace>/recipe/*.json.");
  return result;
}
