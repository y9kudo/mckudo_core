import { createCore, definePlugin } from '../mckudo_core.js';
import { createSimulator } from '../adapters/simulator.js';
const reporting = definePlugin({ id: 'reporting', apiVersion: 1, skills: {
  'reporting:inventory': {
    validate: args => typeof args.label === 'string' || 'Нужна строка label.',
    execute: async (args, { signal, observation }) => { signal.throwIfAborted(); console.log(args.label, observation.inventory); return { ok: true }; },
  },
} });
const core = createCore({ adapter: createSimulator(), config: { schemaVersion: 2, name: 'Inspector', worldId: 'plugin-demo', workflows: [
  { id: 'report', steps: [{ id: 'inventory', action: { skill: 'reporting:inventory', args: { label: 'Содержимое инвентаря' } } }] },
] } }).use(reporting);
await core.tick(); console.log(core.snapshot().plugins); await core.stop();
