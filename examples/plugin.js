import { createCore, definePlugin } from '../overmindmc.js';
import { createSimulator } from '../adapters/simulator.js';
const reporting = definePlugin({ id: 'reporting', apiVersion: 1, skills: {
  'reporting:inventory': {
    validate: args => typeof args.label === 'string' || "I need a line label.",
    execute: async (args, { signal, observation }) => { signal.throwIfAborted(); console.log(args.label, observation.inventory); return { ok: true }; },
  },
} });
const core = createCore({ adapter: createSimulator(), config: { schemaVersion: 2, name: 'Inspector', worldId: 'plugin-demo', workflows: [
  { id: 'report', steps: [{ id: 'inventory', action: { skill: 'reporting:inventory', args: { label: "Equipment contents" } } }] },
] } }).use(reporting);
await core.tick(); console.log(core.snapshot().plugins); await core.stop();
