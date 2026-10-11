import { createCore } from './core.js';
import { createCombatReactor } from './combat.js';
import { createKudoAdapter } from '../adapters/kudoconnect.js';
import { isStorageBlock } from '../packages/kudoconnect/src/containers.js';
import { createLootReactor, createSurvivalReactor } from './survival-brain.js';
import { createNeedsReactor } from './needs.js';
import { createEquipmentReactor } from './equipment-policy.js';
import { createNightReactor } from './rest-policy.js';
import { createHuntingReactor } from './hunting.js';
import {createNeuralNavigator,attachNeuralNavigation} from './neural-navigation.js';
import {createNeuralPlanner} from './neural-planning.js';
import {createSpatialMemory} from './spatial-memory.js';
import {createExplorationPlanner} from './exploration-planner.js';

/** Policy belongs to MCKudo; the transport only executes confirmed storage operations. */
export function createStorageReactor({ radius = 16, recheckMs = 60000, maxStacks = 54, items, clock = Date.now } = {}) {
  if (!Number.isFinite(radius) || radius < 1 || radius > 64 || !Number.isInteger(recheckMs) || recheckMs < 1000 || !Number.isInteger(maxStacks) || maxStacks < 1 || maxStacks > 54 || items !== undefined && (!Array.isArray(items) || !items.length || items.length > 128 || items.some(i => typeof i !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(i)))) throw new Error('Неверная политика хранилищ.');
  return { id: 'mckudo:storage', apiVersion: 1,
    react(o) {
      if (!o.self?.position || o.self.health == null || o.self.health <= 8 || o.self.freeInventorySlots === 0) return { action: null, reason: 'Нет безопасной возможности подобрать предметы.' };
      const p = o.self.position, now = clock();
      const candidates = (o.world?.storages || o.world?.sampledBlocks || []).filter(b => isStorageBlock(b.name))
        .map(b => ({ ...b, distance: Math.hypot(b.position.x - p.x, b.position.y - p.y, b.position.z - p.z) }))
        .filter(b => b.distance <= radius && !(o.storage || []).some(s => s.dimension === o.dimension && (b.key && b.key === s.key || (s.positions || [s.position]).some(p=>p.x===b.position.x&&p.y===b.position.y&&p.z===b.position.z)) && now - s.observedAt >= 0 && now - s.observedAt < recheckMs))
        .sort((a,b) => a.distance - b.distance);
      return candidates[0] ? { priority: 10, action: { skill: 'lootChest', args: { ...candidates[0].position, maxStacks, ...(items ? { items: [...items] } : {}) } }, reason: 'Проверить ближайшее наблюдаемое хранилище.' } : { action: null, reason: 'Нет хранилища для проверки.' };
    }
  };
}

/** Ready-to-use policy profile, still an ordinary extensible MckudoCore instance. */
export function createMinecraftBrain({ client, worldId, config = {}, defense = {}, storage = {}, survival = {}, loot = {}, needs = {}, night = {}, hunting = {}, equipment = true, neural = {}, cognition = {}, spatial = {}, computation = {}, reactors = [], adapterOptions = {}, ...options } = {}) {
  if (!client || typeof worldId !== 'string' || !worldId.trim()) throw new Error('Нужны клиент KudoConnect и постоянный worldId.');
  if (storage !== false && (!storage || typeof storage !== 'object' || Array.isArray(storage))) throw new Error('storage: параметры или false.');
  const thinking = cognition === false ? null : cognition.model || createNeuralPlanner({worldId,memory:cognition.memory});
  if (thinking && thinking.worldId !== worldId) throw new Error('Планировщик принадлежит другому миру.');
  client.planningPolicy = thinking;
  const atlas = spatial === false ? null : spatial.model || createSpatialMemory({ ...spatial, worldId });
  if (atlas && atlas.worldId !== worldId) throw new Error('Пространственная память принадлежит другому миру.');
  const previousLearning = options.learning ?? options.planning?.experience;
  const learning = thinking && previousLearning ? {worldId,assess:(...args)=>previousLearning.assess(...args),record:e=>{previousLearning.record(e);thinking.record(e);}} : thinking || previousLearning;
  const storageNames = client.registry.blocksArray.filter(b=>isStorageBlock(b.name)).map(b=>'minecraft:'+b.name);
  const trackedBlocks = [...new Set([...(adapterOptions.trackedBlocks || ['#logs', '#ores', '#workstations', '#crops','#beds','stone','cobblestone','deepslate','cobbled_deepslate','blackstone']), ...(storage === false ? [] : storageNames)])];
  const explorer = computation === false ? null : computation.planner || createExplorationPlanner({ world: client.world, pool: computation.pool, onReady: () => client.emit('planningReady') });
  if (explorer) client.once('end', () => explorer.close());
  const survivalReactor = survival===false ? null:createSurvivalReactor({client,spatial:atlas,explorationPlanner:explorer,...survival});
  const lootReactor = loot===false ? null:createLootReactor({peer:survival?.peer,...loot});
  const nightReactor=night===false?null:createNightReactor(night);
  const huntingReactor=hunting===false?null:createHuntingReactor(hunting);
  const adapter = createKudoAdapter(client, { ...adapterOptions, trackedBlocks });
  const combatReactor=createCombatReactor({ attackPlayers: true, retaliationHits: 2, retaliationWindowMs: 10000, pathRetreat:client.describe?.().skills?.includes('evade')??false, ...defense });
  if (atlas) {
    const observe = adapter.observe;
    adapter.observe = async context => { const o = await observe(context); atlas.observe(o, { getBlock: p => client.world.blockAt(p) }); return o; };
  }
  const brain = createCore({ ...options, learning,
    config: { schemaVersion: 4, name: client.options.username, tickIntervalMs: 100, actionTimeoutMs: 30000, ...config, worldId },
    adapter,
    reactors: [combatReactor, ...(equipment?[createEquipmentReactor()]:[]), ...(nightReactor?[nightReactor]:[]),...(huntingReactor?[huntingReactor]:[]), ...(storage === false ? [] : [createStorageReactor(storage)]), ...(lootReactor?[lootReactor]:[]),...(needs===false?[]:[createNeedsReactor(needs)]),...(survivalReactor?[survivalReactor]:[]), ...reactors]
  });
  combatReactor.attach(brain);
  survivalReactor?.attach(brain);lootReactor?.attach(brain);
  nightReactor?.attach(brain);
  huntingReactor?.attach(brain);
  if(neural!==false){
    const model=neural.model||createNeuralNavigator({worldId,memory:neural.memory});
    if(model.worldId!==worldId)throw new Error('Нейросеть принадлежит другому миру.');
    client.detachNeuralNavigation?.();client.detachNeuralNavigation=attachNeuralNavigation(client,model);brain.neural=model;
  }
  brain.computation=explorer;brain.spatial=atlas;brain.cognition=thinking;brain.survival=survivalReactor;brain.loot=lootReactor;return brain;
}
