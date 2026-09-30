import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { planRoute, isAir, isFullBlock } from './navigation.js';
import { gazeError } from '../packages/kudoconnect/src/players.js';
const locks = new WeakSet();
const floor = p => Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(p[k])]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const outsiders=(from,to)=>[...from.entities.values(),...to.entities.values()].filter(e=>e.kind==='player'&&![String(from.state.entityId),String(to.state.entityId)].includes(String(e.id))&&e.position);
const clearExchange=(from,to,a,b,radius=3)=>!outsiders(from,to).some(e=>Math.abs(e.position.y-a.y)<2.5&&Math.min(Math.hypot(e.position.x-a.x,e.position.z-a.z),Math.hypot(e.position.x-b.x,e.position.z-b.z))<radius);
const checkClients = (from, to) => {
  if (!from || !to || from === to || !from.state?.position || !to.state?.position || from.state.status !== 'ready' || to.state.status !== 'ready' || from.state.dimension !== to.state.dimension || from.state.health <= 0 || to.state.health <= 0) throw new Error('Взаимодействие требует двух живых клиентов в одном измерении.');
  const a = from.players.entity(to.options.username), b = to.players.entity(from.options.username);
  if (!a || !b || a.id !== String(to.state.entityId) || b.id !== String(from.state.entityId)) throw new Error('Личности и позиции участников не подтверждены обеими сторонами.');
};
/** Preview is based only on both participants' observed blocks. It never executes. */
export function previewInteraction({ from, to, kind = 'meet', item, count = 1, maxDistance = 48 } = {}) {
  checkClients(from, to);
  if (!['meet', 'give'].includes(kind) || !Number.isInteger(count) || count < 1 || count > 64 || !Number.isInteger(maxDistance) || maxDistance < 2 || maxDistance > 64) throw new Error('Встреча: meet/give, count 1–64, maxDistance 2–64.');
  if (kind === 'give' && (typeof item !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(item) || from.inventory.count(item) < count)) throw new Error('Недостаточно предметов для передачи.');
  if (distance(from.state.position, to.state.position) > maxDistance) throw new Error('Участники слишком далеко для локальной встречи.');
  const a = floor(from.state.position), b = floor(to.state.position), readA = p => from.world.blockAt(p), readB = p => to.world.blockAt(p);
  const standable = (get, p) => isAir(get(p)) && isAir(get({ ...p, y: p.y + 1 })) && isFullBlock(get({ ...p, y: p.y - 1 }));
  const pairs = [];
  const visited = new Set(), anchors = [a, b, floor({ x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2 })];
  for (const anchor of anchors) for (let dy = -3; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const first = { x: anchor.x + dx, y: anchor.y + dy, z: anchor.z + dz }, key = `${first.x},${first.y},${first.z}`;
    if (visited.has(key)) continue; visited.add(key);
    if (!standable(readA, first) || !standable(readB, first)) continue;
    for (const [x, z] of [[2,0],[-2,0],[0,2],[0,-2]]) {
      const second = { x: first.x + x, y: first.y, z: first.z + z };
      if (standable(readA, second) && standable(readB, second) && clearExchange(from,to,{...first,x:first.x+.5,z:first.z+.5},{...second,x:second.x+.5,z:second.z+.5},3.8)) pairs.push({ first, second, score: distance(a, first) + distance(b, second) });
    }
  }
  pairs.sort((x,y) => x.score - y.score);
  const routes = new Map();
  const route = (label,start,goal,getBlock) => { const key = `${label}:${goal.x},${goal.y},${goal.z}`; if (!routes.has(key)) routes.set(key,planRoute({ start, goal, getBlock, maxDistance, maxNodes: 3000, maxDrop: 2 })); return routes.get(key); };
  for (const pair of pairs.slice(0, 64)) {
    const one = route('from',a,pair.first,readA);
    if (one.status !== 'planned') continue;
    const two = route('to',b,pair.second,readB);
    if (two.status === 'planned') return { kind, item: item ?? null, count, from: from.options.username, to: to.options.username, meeting: { from: pair.first, to: pair.second }, routes: { from: one.steps.length, to: two.steps.length } };
  }
  throw new Error('Нет доступного места встречи, подтверждённого обоими участниками.');
}

/** Bilateral execution with an evidence ledger; a partial gift is never silently retried. */
export async function runInteraction({ from, to, kind = 'meet', item, count = 1, timeoutMs = 30000, signal, peers, priority = 20 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || !Number.isFinite(priority) || priority < -1000 || priority > 1000) throw new Error('Встреча: неверные timeoutMs/priority.');
  if (locks.has(from) || locks.has(to)) throw new Error('Участник уже занят другим взаимодействием.');
  const plan = previewInteraction({ from, to, kind, item, count });
  locks.add(from); locks.add(to);
  const controller = new AbortController(), combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), from.connectionAbort.signal, to.connectionAbort.signal]);
  const timer = setTimeout(() => controller.abort(new Error('Истекло время взаимодействия.')), timeoutMs);
  const report = { id: randomUUID(), plan, status: 'running', journal: [], before: { from: from.inventory.snapshot(), to: to.inventory.snapshot() }, after: null, reason: '' };
  const log = (phase, evidence = {}) => { report.journal.push({ at: Date.now(), phase, evidence }); };
  const countA = kind === 'give' ? from.inventory.count(item) : 0, countB = kind === 'give' ? to.inventory.count(item) : 0;
  const watches = [], receipts = [];
  const onCollect = event => { if (event.own) receipts.push({ id: event.id, count: event.count }); };
  to.on('collect', onCollect);
  try {
    combined.throwIfAborted(); log('prepared', { bothIdentitiesObserved: true });
    for (const [client, other] of [[from, to], [to, from]]) {
      const peer = peers?.get(client.options.username);
      peer?.send('interaction', { id: report.id, phase: 'ready', partner: other.options.username, kind, item: item ?? null, count }, { to: other.options.username });
    }
    // Sequential moves avoid two agents walking through each other's reserved meeting cell.
    for (const [client, target] of [[from, plan.meeting.from], [to, plan.meeting.to]]) {
      await client.execute({ skill: 'goto', args: { ...target, range: 0 } }, { signal: combined, priority });
      checkClients(from, to);
    }
    log('arrived', { from: { ...from.state.position }, to: { ...to.state.position } });
    watches.push(from.watchPlayer(to.options.username, { durationMs: timeoutMs, priority }), to.watchPlayer(from.options.username, { durationMs: timeoutMs, priority }));
    // Require the rotation received by the OTHER observer, not merely a local look request.
    let errors;
    const waitForGaze = async () => { while (true) {
      combined.throwIfAborted(); checkClients(from, to);
      errors = [gazeError(to.players.entity(from.options.username), to.state), gazeError(from.players.entity(to.options.username), from.state)];
      if (errors.every(e => e !== null && e <= 12)) break;
      await delay(50, undefined, { signal: combined });
    } };
    await waitForGaze();
    log('mutual-gaze', { observedErrorsDegrees: errors });
    if (kind === 'give') {
      if (distance(from.state.position, to.state.position) > 3) throw new Error('Участники разошлись до передачи.');
      if(!clearExchange(from,to,from.state.position,to.state.position))throw new Error('Другой игрок подошёл к месту передачи; предмет пока не выброшен.');
      await from.execute({ skill: 'drop', args: { item, count } }, { signal: combined, priority });
      log('released', { senderCount: from.inventory.count(item), requestedCount: count });
      while (to.inventory.count(item) < countB + count) {
        combined.throwIfAborted(); checkClients(from, to);
        const baseline = to.inventory.count(item);
        await to.execute({ skill: 'collect', args: { item, beforeCount: baseline, timeoutMs: Math.min(8000, timeoutMs), origin: { ...from.state.position } } }, { signal: combined, priority });
      }
      if (from.inventory.count(item) > countA - count || !receipts.length) throw new Error('Не хватает подтверждений передачи: инвентари и событие подбора.');
      log('received', { fromCount: from.inventory.count(item), toCount: to.inventory.count(item), pickupReceipts: receipts });
      await waitForGaze(); log('mutual-gaze-after-transfer', { observedErrorsDegrees: errors });
    }
    report.status = 'completed'; log('completed');
    for (const [client, other] of [[from, to], [to, from]]) {
      try { peers?.get(client.options.username)?.send('interaction', { id: report.id, phase: 'completed' }, { to: other.options.username }); }
      catch (error) { log('notification-failed', { reason: String(error.message).slice(0, 200) }); }
    }
  } catch (error) {
    report.status = kind === 'give' && from.inventory.count(item) < countA ? 'partial' : combined.aborted ? 'cancelled' : 'failed';
    report.reason = String((combined.aborted ? combined.reason : error)?.message || error).slice(0, 500); log(report.status, { reason: report.reason });
  } finally {
    clearTimeout(timer); watches.forEach(w => w.stop()); to.removeListener('collect', onCollect);
    report.after = { from: from.inventory.snapshot(), to: to.inventory.snapshot() }; locks.delete(from); locks.delete(to);
  }
  return report;
}
