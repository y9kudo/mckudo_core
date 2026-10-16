const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const resource = s => typeof s === 'string' ? s.includes(':') ? s : `minecraft:${s}` : null;
const unknown = reason => ({ status: 'unknown', reason });

/** Read-only outcome checks. Absence from a sampled-block list is never evidence of air. */
export function verifyMinecraftAction(client, action, { before, after }) {
  const args = action.args || {};
  if (['craft', 'smelt'].includes(action.skill)) {
    const item = resource(args.item);
    if (!item || !Object.hasOwn(before?.inventory || {}, item) || !Object.hasOwn(after?.inventory || {}, item)) return unknown('Output counts are not present in both observations.');
    return { status: after.inventory[item] > before.inventory[item] ? 'confirmed' : 'unconfirmed', reason: `Observed output count for ${item} ${after.inventory[item] > before.inventory[item] ? 'increased' : 'did not increase'}.` };
  }
  if (['navigate', 'goto'].includes(action.skill)) {
    if (!point(args) || !point(after?.self?.position)) return unknown('The observed destination or character position is unavailable.');
    const range = args.range ?? 1;
    const reached = ['x', 'y', 'z'].every(k => Math.abs(Math.floor(after.self.position[k]) - Math.floor(args[k])) <= range);
    return { status: reached ? 'confirmed' : 'unconfirmed', reason: reached ? 'Fresh position is within the requested destination range.' : 'Fresh position is outside the requested destination range.' };
  }
  if (action.skill === 'dig' && point(args)) {
    const p = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(args[k])]));
    const expected = resource(args.block) || (before.world?.sampledBlocks || []).find(b => point(b.position) && ['x', 'y', 'z'].every(k => b.position[k] === p[k]))?.name;
    const actual = client.world.blockAt(p), name = resource(actual?.name || actual?.id);
    if (!expected || !name) return unknown('The original or current block is unknown; no removal is inferred.');
    return { status: name !== expected ? 'confirmed' : 'unconfirmed', reason: name !== expected ? 'Live block evidence confirms the targeted block changed.' : 'Live block evidence still contains the targeted block.' };
  }
  return unknown('This skill has no generic world-effect verifier; its executor and goal conditions retain responsibility.');
}
