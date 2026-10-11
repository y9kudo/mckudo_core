import {assessFall} from './fall.js';
import { navigationScheduler } from './scheduler.js';
const key = p => `${p.x},${p.y},${p.z}`;
const point = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1,1], [1,-1], [-1,1], [-1,-1]];
// Collision-free plants are traversable too; neither liquids nor portals are empty walking space.
export const isAir = b => Boolean(b && (['air', 'cave_air', 'void_air', 'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(b.name || b.id) ||
  b.boundingBox === 'empty' && Array.isArray(b.shapes) && b.shapes.length === 0 && !/(?:^|:)(?:water|lava|bubble_column|fire|soul_fire|cobweb|nether_portal|end_portal|sweet_berry_bush|wither_rose|powder_snow)$/.test(b.name || b.id)));
export const isHazard = b => b && /(?:^|:)(?:lava|water|fire|soul_fire|cactus|magma_block|powder_snow|sweet_berry_bush|wither_rose)$/.test(b.name || b.id);
export const isFullBlock = b => Boolean(b && !isHazard(b) && b.boundingBox === 'block' && (!b.shapes || b.shapes.some(s => s.length === 6 && s.every((v, i) => v === (i < 3 ? 0 : 1)))));
class Heap {
  values = [];
  push(v) { const a = this.values; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= v.f) break; a[i] = a[p]; i = p; } a[i] = v; }
  pop() { const a = this.values, result = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].f < a[j].f) j++; if (a[j].f >= last.f) break; a[i] = a[j]; i = j; } a[i] = last; } return result; }
}

/** Bounded A* on observed voxels. Each node is a feet position; unknown space is never air. */
function* routeSearch({ start, goal, getBlock, occupied = () => false, edgeCost = () => 0, range = 0, maxNodes = 12000, maxDistance = 128, maxDrop = 3, fallPolicy = {}, bridgeBudget = 0, bridgeBlock = 'minecraft:cobblestone', canDig = () => false, canPlace = () => true, allowPartial = false, signal }) {
  signal?.throwIfAborted();
  if (!point(start) || !point(goal) || typeof getBlock !== 'function' || typeof canDig !== 'function' || typeof canPlace !== 'function') throw new Error('Маршрут: нужны целые start/goal и getBlock/canDig/canPlace.');
  for (const [n, value, min, max] of [['range', range, 0, 16], ['maxNodes', maxNodes, 1, 100000], ['maxDistance', maxDistance, 1, 512], ['maxDrop', maxDrop, 1, 32], ['bridgeBudget', bridgeBudget, 0, 256]]) if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${n}: ${min}–${max}.`);
  if (typeof bridgeBlock !== 'string' || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(bridgeBlock)) throw new Error('bridgeBlock: namespace:id.');
  if (typeof allowPartial !== 'boolean') throw new Error('allowPartial: boolean.');
  const unknown = new Map(), cache = new Map(), signatures = new WeakMap();
  let changes = null, copied = false, excavated = 0;
  const emptyBlock = {name:'air',boundingBox:'empty',shapes:[]};
  const change = (p, block) => { if (!copied) { changes = new Map(changes); copied = true; } changes.set(key(p), block); };
  const stateKey = (p, used, damage, edits, digs) => {
    if (edits && !signatures.has(edits)) signatures.set(edits,[...edits].map(([k,b])=>k+'='+b.name).sort().join(';'));
    return `${key(p)}/${used}/${damage}/${digs}/${edits?signatures.get(edits):''}`;
  };
  const read = p => { const k = key(p); if (changes?.has(k)) return changes.get(k); if (!cache.has(k)) cache.set(k, getBlock(p) || null); const b = cache.get(k); if (!b && unknown.size < 64) unknown.set(k, p); return b; };
  const air = p => isAir(read(p));
  const excavate = (cell, steps) => {
    const b = read(cell);
    if (isAir(b)) return 0;
    if (!b || isHazard(b) || b.diggable === false || excavated >= 32 || !canDig(b, cell)) return null;
    const neighbors = [...directions.map(([x, z]) => ({ x: cell.x + x, y: cell.y, z: cell.z + z })), { ...cell, y: cell.y + 1 }];
    if (neighbors.some(q => { const v = read(q); return !v || isHazard(v) || /(?:sand|gravel|concrete_powder|anvil|dripstone)$/.test(v.name || v.id); })) return null;
    steps.push({ kind: 'dig', position: cell, expected: b.name || b.id }); change(cell,emptyBlock); excavated++; return 5 + Math.max(0, b.hardness || 0);
  };
  if (!air(start) || !air({ ...start, y: start.y + 1 }) || !isFullBlock(read({ ...start, y: start.y - 1 }))) return { status: 'blocked', reason: 'Старт не подтверждён как свободная ячейка с опорой.', steps: [], visited: 0, unknown: [...unknown.values()] };
  const distance = p => Math.max(Math.abs(p.x - goal.x), Math.abs(p.y - goal.y), Math.abs(p.z - goal.z));
  const heuristic = p => {const dx=Math.max(0,Math.abs(p.x-goal.x)-range),dz=Math.max(0,Math.abs(p.z-goal.z)-range);return Math.max(dx,dz)+(Math.SQRT2-1)*Math.min(dx,dz)+Math.max(0,Math.abs(p.y-goal.y)-range)*.3;};
  const open = new Heap(), best = new Map(), first = { p: { ...start }, g: 0, f: heuristic(start), used: 0, damage:0, edits:null, excavated:0, parent: null, steps: [] };
  open.push(first); best.set(stateKey(start,0,0,null,0), 0); let visited = 0;
  let partial = null;
  const finish = (node, isPartial = false) => {
    const sections = []; let cursor = node; while (cursor.parent) { sections.push(cursor.steps); cursor = cursor.parent; }
    return { status: 'planned', reason: isPartial ? 'Промежуточный участок по наблюдаемым блокам; конечная цель ещё не достигнута.' : 'Маршрут по известным блокам.', partial:isPartial, target:{...node.p}, steps:sections.reverse().flat(), visited, cost:node.g, fallDamage:node.damage, bridgeUsed:node.used, unknown:[...unknown.values()] };
  };
  const heights = [0, 1, ...Array.from({ length: maxDrop }, (_, i) => -i - 1)];
  while (open.values.length && visited < maxNodes) {
    yield visited;
    signal?.throwIfAborted();
    const node = open.pop(); if (node.g !== best.get(stateKey(node.p,node.used,node.damage,node.edits,node.excavated))) continue; visited++;
    if (distance(node.p) <= range) return finish(node);
    if (allowPartial && heuristic(node.p) <= first.f - 2 && (!partial || heuristic(node.p)+node.g*.1 < heuristic(partial.p)+partial.g*.1)) partial=node;
    for (const [dx, dz] of directions) for (const dy of dx && dz ? [0] : heights) {
      changes = node.edits; copied = false; excavated = node.excavated;
      const p = { x: node.p.x + dx, y: node.p.y + dy, z: node.p.z + dz };
      if(occupied(p))continue;
      const diagonal=dx!==0&&dz!==0;
      if(diagonal&&(dy!==0||!isFullBlock(read({...p,y:p.y-1}))||[{x:node.p.x+dx,y:node.p.y,z:node.p.z},{x:node.p.x,y:node.p.y,z:node.p.z+dz}].some(q=>occupied(q)||!air(q)||!air({...q,y:q.y+1})||!isFullBlock(read({...q,y:q.y-1})))))continue;
      if (Math.max(Math.abs(p.x - start.x), Math.abs(p.z - start.z), Math.abs(p.y - start.y)) > maxDistance) continue;
      const floor = { ...p, y: p.y - 1 }, head = { ...p, y: p.y + 1 }, steps = []; let cost = (diagonal?Math.SQRT2:1) + Math.abs(dy) * 0.3, used = node.used, safe = true;
      // A one-block staircase can clear headroom without touching either support.
      // Larger falls must already have a clear shaft; excavation never digs blindly downward.
      if (dy > 0) { const extra = excavate({ ...node.p, y: node.p.y + 2 }, steps); if (extra === null) continue; cost += extra; }
      for (let y = p.y; y <= Math.max(p.y + 1, node.p.y + 1); y++) {
        const cell = { ...p, y }, b = read(cell);
        if (isAir(b)) continue;
        const extra = dy < -1 || diagonal ? null : excavate(cell, steps);
        if (extra === null) { safe = false; break; } cost += extra;
      }
      if (!safe) continue;
      if (!isFullBlock(read(floor))) {
        if (dy !== 0 || !isAir(read(floor)) || used >= bridgeBudget || !canPlace(floor)) continue;
        steps.push({ kind: 'bridge', position: floor, block: bridgeBlock }); used++; cost += 8;
        change(floor,{name:bridgeBlock,boundingBox:'block',shapes:[[0,0,0,1,1,1]],diggable:false});
      }
      let fall,damage=node.damage;
      if(dy<0){fall=assessFall({...fallPolicy,height:-dy,health:(fallPolicy.health??20)-damage,landing:read(floor)});if(!fall.allowed)continue;damage+=fall.estimatedDamage;cost+=fall.estimatedDamage*4;}
      steps.push({ kind: dy === 1 ? 'jump' : dy < 0 ? 'drop' : 'walk', position: p,...(fall?{fall}: {}) });
      const learned=edgeCost(node.p,p,steps.at(-1).kind);
      if(!Number.isFinite(learned)||learned<0||learned>1000)throw new Error('edgeCost должен вернуть число 0–1000.');
      cost+=learned;
      const g = node.g + cost, id = stateKey(p,used,damage,changes,excavated);
      if (g >= (best.get(id) ?? Infinity)) continue;
      best.set(id, g); open.push({ p, g, f: g + heuristic(p), used, damage, edits:changes, excavated, parent: node, steps });
    }
  }
  if (partial) return finish(partial, true);
  return { status: 'blocked', reason: visited >= maxNodes ? 'Исчерпан бюджет поиска маршрута.' : 'Нет пути в наблюдаемой области с заданными правилами.', steps: [], visited, unknown: [...unknown.values()] };
}

/** Synchronous API for small offline searches. */
export function planRoute(options) {
  const search = routeSearch(options);
  let step;
  do { step = search.next(); } while (!step.done);
  return step.value;
}

export function readRouteWorld(world) {
  const view = world.createReadView?.();
  return { getBlock: view ? view.blockAt : p => world.blockAt(p), getRevision: view ? view.isCurrent : () => world.revision };
}

/** Same A* with bounded slices so sockets, physics and other agents can run. */
export async function planRouteAsync(options, { sliceMs = 2, nodesPerSlice = 64, getRevision, scheduler = navigationScheduler } = {}) {
  if (!Number.isFinite(sliceMs) || sliceMs < .5 || sliceMs > 10 || !Number.isInteger(nodesPerSlice) || nodesPerSlice < 1 || nodesPerSlice > 256 || getRevision !== undefined && typeof getRevision !== 'function') throw new Error('Поиск: sliceMs 0.5–10, nodesPerSlice 1–256, getRevision — функция.');
  options.signal?.throwIfAborted();
  if (!scheduler || typeof scheduler.submit !== 'function') throw new Error('Нужен scheduler с submit().');
  const revision = getRevision?.();
  return scheduler.submit(routeSearch(options), { signal: options.signal, sliceMs, nodesPerSlice,
    validate() { if (getRevision && getRevision() !== revision) throw new Error('Мир изменился во время поиска маршрута; нужно повторное планирование.'); }
  });
}
