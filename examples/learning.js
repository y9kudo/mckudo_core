// Deterministic laboratory, not a completed Minecraft run.
import { createCore, createExperienceModel } from '../mckudo_core.js';
const experience = createExperienceModel({ worldId: 'learning-lab', facts: ['/inventory/wood'], contextFacts: ['/dimension'] });
let wood = 0;
const adapter = {
  describe: () => ({ protocolVersion: 1, skills: ['gather'] }),
  observe: async () => ({ dimension: 'minecraft:overworld', inventory: { wood } }),
  execute: async action => { if (action.skill !== 'gather') throw new Error('Unknown action'); wood++; return { ok: true }; }
};
const practice = createCore({ config: { schemaVersion: 4, name: 'Alice', worldId: 'learning-lab', rules: [{ id: 'try', action: { skill: 'gather', args: {} } }] }, adapter, learning: experience });
try { for (let i = 0; i < 3; i++) await practice.tick(); } finally { await practice.stop(); }
console.log('Оператор из трёх наблюдений:', experience.operators());
const goal = createCore({ config: { schemaVersion: 4, name: 'Alice', worldId: 'learning-lab', goals: [{ id: 'five', desired: { fact: '/inventory/wood', gte: 5 } }] }, adapter, planning: { experience, minIntervalMs: 0 } });
try { for (let i = 0; i < 2; i++) await goal.tick(); console.log('Фактический результат:', goal.snapshot().brain); } finally { await goal.stop(); }
