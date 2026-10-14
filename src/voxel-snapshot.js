import { setImmediate as yieldLoop } from 'node:timers/promises';

const point = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);

/** Copy only observed geometry. Index 0 is unknown, never air. Yield while copying. */
export async function captureVoxels({ position, radius = 24, mode = 'surface', getBlock, signal, isCurrent = () => true }) {
  if (!point(position) || !Number.isInteger(radius) || radius < 4 || radius > 32 || !['surface', 'ores'].includes(mode) || typeof getBlock !== 'function') throw new Error('CPU snapshot: position, getBlock, radius 4–32, mode surface/ores.');
  const min = { x: position.x - radius - 1, y: position.y - (mode === 'ores' ? Math.min(24, radius) + 4 : 8), z: position.z - radius - 1 };
  const size = { x: radius * 2 + 3, y: position.y + 5 - min.y + 1, z: radius * 2 + 3 };
  const ids = new Uint16Array(size.x * size.y * size.z), palette = [null], names = new Map();
  let i = 0;
  for (let y = min.y; y < min.y + size.y; y++) for (let z = min.z; z < min.z + size.z; z++) for (let x = min.x; x < min.x + size.x; x++) {
    if (i % 512 === 0) { signal?.throwIfAborted(); if (!isCurrent()) throw new Error("The world has changed in copying geometry."); await yieldLoop(); }
    const b = getBlock({ x, y, z });
    if (b) {
      const geometry = { name: b.name || b.id, boundingBox: b.boundingBox, shapes: b.shapes, diggable: b.diggable, hardness: b.hardness };
      const key = Number.isInteger(b.stateId) ? b.stateId : JSON.stringify(geometry);
      if (!names.has(key)) { if (palette.length >= 4096) throw new Error("Too many types of geometry."); names.set(key, palette.length); palette.push(geometry); }
      ids[i] = names.get(key);
    }
    i++;
  }
  signal?.throwIfAborted(); if (!isCurrent()) throw new Error("The world has changed in copying geometry.");
  return { min, size, ids, palette };
}

export function readVoxelSnapshot({ min, size, ids, palette } = {}) {
  if (!point(min) || !size || !['x', 'y', 'z'].every(k => Number.isInteger(size[k]) && size[k] > 0 && size[k] <= 128) || size.x * size.y * size.z > 200000 || !(ids instanceof Uint16Array) || ids.length !== size.x * size.y * size.z || !Array.isArray(palette) || palette.length < 1 || palette.length > 4096 || palette[0] !== null) throw new Error("Damaged snapshot Geometry.");
  return p => {
    const x = Math.floor(p.x) - min.x, y = Math.floor(p.y) - min.y, z = Math.floor(p.z) - min.z;
    return x < 0 || y < 0 || z < 0 || x >= size.x || y >= size.y || z >= size.z ? null : palette[ids[(y * size.z + z) * size.x + x]] || null;
  };
}
