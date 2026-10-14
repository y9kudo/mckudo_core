import { setTimeout as delay } from 'node:timers/promises';
import { planRoute, isAir, isFullBlock, isHazard } from '../src/navigation.js';

/** OvermindMC local movement controller; bot supplies physics and server-confirmed blocks. */
export function createNavigator(bot, { searchRadius, check }) {
  const vector = p => bot.entity.position.offset(p.x - bot.entity.position.x, p.y - bot.entity.position.y, p.z - bot.entity.position.z);
  const blockAt = p => bot.blockAt(vector(p));
  return async (args, signal) => {
    if (!['x', 'y', 'z'].every(k => Number.isInteger(args[k]))) throw new Error("navigate: integers are required x/y/z.");
    const bridgeBlock = args.bridgeBlock || 'minecraft:cobblestone';
    const name = bridgeBlock.replace(/^minecraft:/, ''), material = bot.registry.blocksByName[name];
    if (args.bridgeBudget && (!material || !isFullBlock(material) || /(?:sand|gravel|concrete_powder|chest|furnace|smoker|crafting_table)/.test(name))) throw new Error("A bridge needs a normal full-strength block.");
    const available = bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
    const start = Object.fromEntries(['x', 'y', 'z'].map(k => [k, Math.floor(bot.entity.position[k])]));
    const digNames = args.digBlocks || [];
    if (!Array.isArray(digNames) || digNames.some(n => typeof n !== 'string') || digNames.length > 64) throw new Error("digBlocks: to 64 ID.");
    const route = planRoute({ start, goal: args, getBlock: blockAt, range: args.range ?? 0, maxDistance: searchRadius,
      maxNodes: args.maxNodes ?? 12000, bridgeBudget: Math.min(args.bridgeBudget ?? 0, available), bridgeBlock, signal,
      canDig: b => digNames.includes('minecraft:' + b.name) && b.canHarvest(bot.pathfinder.bestHarvestTool(b)?.type ?? null) });
    if (route.status !== 'planned') throw new Error(route.reason);
    bot.pathfinder.setGoal(null);
    try {
      for (const step of route.steps) {
        check(signal); const target = vector(step.position);
        if (step.kind === 'dig') {
          const block = blockAt(step.position);
          if (!block || block.name !== step.expected || target.distanceTo(bot.entity.position) > 4.5 || !digNames.includes('minecraft:' + block.name)) throw new Error("The mining route has changed.");
          const moves = bot.pathfinder.movements, old = moves.canDig; let safe;
          try { moves.canDig = true; safe = moves.safeToBreak(block); } finally { moves.canDig = old; }
          if (!safe) throw new Error("The route block cannot be safely obtained.");
          const tool = bot.pathfinder.bestHarvestTool(block); if (tool) await bot.equip(tool, 'hand'); check(signal);
          await bot.dig(block); check(signal); if (!isAir(blockAt(step.position))) throw new Error("No confirmed route mining.");
        } else if (step.kind === 'bridge') {
          const foot = bot.entity.position.floored(), ref = bot.blockAt(foot.offset(0, -1, 0));
          if (!isAir(blockAt(step.position)) || !isFullBlock(ref) || Math.abs(ref.position.y - target.y) > 0 || Math.abs(ref.position.x - target.x) + Math.abs(ref.position.z - target.z) !== 1) throw new Error("No support for the next block of the bridge.");
          const item = bot.inventory.items().find(i => i.name === name); if (!item) throw new Error("Bridge material finished.");
          bot.setControlState('sneak', true);
          await bot.equip(item, 'hand'); check(signal);
          await bot.placeBlock(ref, target.minus(ref.position)); check(signal);
          if (blockAt(step.position)?.name !== name) throw new Error("The server did not confirm the bridge block.");
          bot.setControlState('sneak', false);
        } else {
          const center = target.offset(0.5, 0, 0.5), deadline = Date.now() + 4000;
          while (Math.hypot(bot.entity.position.x - center.x, bot.entity.position.z - center.z) > 0.2 || Math.abs(bot.entity.position.y - center.y) > 0.2) {
            check(signal);
            if (!isAir(blockAt(step.position)) || !isAir(blockAt({ ...step.position, y: step.position.y + 1 })) || !isFullBlock(blockAt({ ...step.position, y: step.position.y - 1 }))) throw new Error("The route cell has changed; Re-engineering required.");
            if (Date.now() >= deadline || bot.entity.position.y < center.y - 1 || isHazard(bot.blockAt(bot.entity.position))) throw new Error("Movement stopped: no progress or dangerous position.");
            await bot.lookAt(center.offset(0, 1.5, 0), true); check(signal);
            bot.setControlState('forward', true); bot.setControlState('jump', step.kind === 'jump' && bot.entity.position.y < center.y);
            await delay(50, undefined, { signal });
          }
          bot.clearControlStates();
        }
      }
      return route;
    } finally { bot.clearControlStates(); }
  };
}
