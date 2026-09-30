import chunkLoader from 'prismarine-chunk';
import blockLoader from 'prismarine-block';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { EventEmitter } from 'node:events';

/** Authoritative, bounded world cache. Unknown chunks stay unknown. */
export class KudoWorld extends EventEmitter {
  constructor(registry, { maxChunks = 1024 } = {}) {
    super();
    this.registry = registry; this.Chunk = chunkLoader(registry); this.Block = blockLoader(registry);
    if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 4096) throw new Error('maxChunks: 1–4096.');
    this.maxChunks = maxChunks; this.focus = { x: 0, z: 0 }; this.columns = new Map(); this.classes = new Map(); this.revision = 0; this.reset('minecraft:overworld');
    const all = registry.blocksArray.map(b => b.name);
    for (const [group, pattern] of Object.entries({ logs: /(_log|_stem)$/, leaves: /_leaves$/, ores: /_ore$|^ancient_debris$/, deepslate_ores: /^deepslate_.*_ore$/, crops: /^(wheat|carrots|potatoes|beetroots|nether_wart)$/, workstations: /^(crafting_table|furnace|smoker|blast_furnace|brewing_stand)$/ })) this.classes.set(group, all.filter(n => pattern.test(n)));
    this.classes.set('tree', [...this.classes.get('logs'), ...this.classes.get('leaves')]);
    this.classes.set('beds',all.filter(n=>n.endsWith('_bed')));
    this.classes.set('containers', all.filter(n => ['chest','trapped_chest','barrel'].includes(n) || n.endsWith('shulker_box')));
  }
  registerClass(name, members) {
    if (!/^[a-z0-9_:.-]{1,100}$/.test(name) || !Array.isArray(members) || members.length > 4096 || members.some(n => typeof n !== 'string' || !this.registry.blocksByName[n.replace(/^minecraft:/, '')])) throw new Error('Класс: имя и существующие блоки.');
    this.classes.set(name, [...new Set(members.map(n => n.replace(/^minecraft:/, '')))]);
  }
  resolveSelectors(selectors) {
    if (!Array.isArray(selectors) || selectors.length > 4096) throw new Error('Нужен список ID/#классов.');
    return [...new Set(selectors.flatMap(n => { if (typeof n !== 'string') throw new Error('Селектор должен быть строкой.'); const group = n.startsWith('#') ? this.classes.get(n.slice(1)) : [n.replace(/^minecraft:/, '')]; if (!group || group.some(id => !this.registry.blocksByName[id])) throw new Error(`Неизвестный селектор ${n}.`); return group; }))];
  }
  reset(dimension, minY = dimension === 'minecraft:overworld' ? -64 : 0, height = dimension === 'minecraft:overworld' ? 384 : 256) {
    this.dimension = dimension; this.minY = minY; this.height = height; this.columns.clear(); this.revision++;
  }
  load(packet) {
    const column = new this.Chunk({ minY: this.minY, worldHeight: this.height }); column.load(packet.chunkData);
    this.columns.set(`${packet.x},${packet.z}`, column); this.revision++;
    this.emit('chunkLoad', { x: packet.x, z: packet.z });
    if (this.columns.size > this.maxChunks) {
      const farthest = [...this.columns.keys()].sort((a, b) => {
        const score = key => { const [x, z] = key.split(',').map(Number); return Math.hypot(x * 16 + 8 - this.focus.x, z * 16 + 8 - this.focus.z); };
        return score(b) - score(a);
      })[0]; const [x, z] = farthest.split(',').map(Number); this.unload(x, z);
    }
  }
  unload(x, z) { this.columns.delete(`${x},${z}`); this.revision++; this.emit('chunkUnload', { x, z }); }
  columnAt(p) { return this.columns.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`); }
  stateAt(p) {
    if (p.y < this.minY || p.y >= this.minY + this.height) return null;
    const column = this.columnAt(p); return column ? column.getBlockStateId({ x: Math.floor(p.x) & 15, y: Math.floor(p.y), z: Math.floor(p.z) & 15 }) : null;
  }
  blockAt(p) {
    const stateId = this.stateAt(p); if (stateId === null) return null;
    const block = this.Block.fromStateId(stateId, 0); block.position = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; return block;
  }
  update(p, stateId) {
    const column = this.columnAt(p); if (!column) return false;
    const previous = this.stateAt(p);
    column.setBlockStateId({ x: Math.floor(p.x) & 15, y: Math.floor(p.y), z: Math.floor(p.z) & 15 }, stateId); this.revision++;
    this.emit('blockUpdate', { position: { ...p }, previous, stateId }); return true;
  }
  async findBlocks({ names = [], classes = [], properties = {}, position, radius = 32, count = 32, maxVisited = 250000, signal }) {
    names = this.resolveSelectors([...names, ...classes]);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || Object.keys(properties).length > 16) throw new Error('properties: до 16 свойств блока.');
    if (!Array.isArray(names) || !position || !Number.isInteger(radius) || radius < 1 || radius > 512 || !Number.isInteger(count) || count < 1 || count > 512 || !Number.isInteger(maxVisited) || maxVisited < 1 || maxVisited > 2000000) throw new Error('KudoWorld.findBlocks: неверные параметры поиска.');
    const ids = new Set(names.flatMap(n => { const b = this.registry.blocksByName[n.replace(/^minecraft:/, '')]; if (!b) return []; return Array.from({ length: b.maxStateId - b.minStateId + 1 }, (_, i) => b.minStateId + i); }));
    const sections = [];
    for (const [key, column] of this.columns) {
      const [cx, cz] = key.split(',').map(Number);
      for (let i = 0; i < column.sections.length; i++) {
        const section = column.sections[i], base = { x: cx * 16, y: this.minY + i * 16, z: cz * 16 };
        const minDistance = Math.hypot(...['x', 'y', 'z'].map(k => Math.max(base[k] - position[k], 0, position[k] - (base[k] + 16))));
        // 1.18+ palettes live inside section.data; single-value sections have no palette.
        const palette = section?.data?.palette ?? section?.palette;
        const single = section?.data?.value;
        if (!section || minDistance > radius || palette && !palette.some(s => ids.has(s)) || Number.isInteger(single) && !ids.has(single)) continue;
        sections.push({ column, base, minDistance });
      }
    }
    sections.sort((a, b) => a.minDistance - b.minDistance); let visited = 0, truncated = false; const found = [];
    outer: for (const { column, base, minDistance } of sections) {
      if (found.length >= count && minDistance > found[count - 1].distance) break;
      for (let y = base.y; y < base.y + 16; y++) for (let z = base.z; z < base.z + 16; z++) for (let x = base.x; x < base.x + 16; x++) {
        if (++visited > maxVisited) { truncated = true; break outer; }
        if (visited % 4096 === 0) { signal?.throwIfAborted(); await yieldLoop(); }
        const distance = Math.hypot(x + 0.5 - position.x, y + 0.5 - position.y, z + 0.5 - position.z); if (distance > radius) continue;
        const id = column.getBlockStateId({ x: x & 15, y, z: z & 15 });
        if (ids.has(id)) {
          const actual = this.Block.fromStateId(id, 0).getProperties();
          if (Object.entries(properties).every(([k, v]) => actual[k] === v)) found.push({ name: 'minecraft:' + this.registry.blocksByStateId[id].name, position: { x, y, z }, distance, stateId: id, properties: actual });
        }
      }
      found.sort((a, b) => a.distance - b.distance); found.length = Math.min(found.length, count);
    }
    signal?.throwIfAborted(); found.sort((a, b) => a.distance - b.distance);
    return { blocks: found.slice(0, count), visited, truncated, revision: this.revision };
  }
}
