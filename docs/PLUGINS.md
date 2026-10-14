# Skills plagins

Plagin — JavaScript-Skills module. It's connected to the application; JSON only selects the registered action. The kernel does not download or execute arbitrary modules from configuration.

~~~js
import { definePlugin } from 'overmindmc';

export const inventoryTools = definePlugin({
  id: 'inventory-tools',
  apiVersion: 1,
  skills: {
    'inventory-tools:report': {
      validate: args =>
        typeof args.label === 'string' || 'I need a line label.',
      async execute(args, { signal, observation }) {
        signal.throwIfAborted();
        console.log(args.label, observation.inventory);
        return { ok: true };
      }
    }
  }
});
~~~

Connect: core.use(inventoryTools). After that, name inventory-tools:report available in action.skill.

validate Receives a copy args. false or row means error of argument; true or undefined Allow compliance. The test may be asynchronous, But you mustn't change the world by yourself. execute Received signal and observation. Deletion of or { ok: false, message } means failure.

One skill available core.registerSkill(name, handler, { validate }). Plagin is more comfortable, When skills are shared.

## Dependence and conflict

requires: ["base-plugin"] requires, I want the said plagins already connected. Independence, duplicates ID and conflicting skills names are prohibited. Check performed before registration: If you're wrong, half the skills will not be set.

core.removePlugin(id) Removes the skills set, If no one's dependent on it and the current step is complete. During the performance of the operation, connection and removal of the plagins is prohibited. The external connections of the plagina are controlled by the application: use/removePlugin They don't create or close them themselves.

Plagins are executed in process Node.js and are not an isolated sandbox. They should be connected as a normal application's trusted relationships.

List of authorized available in snapshot().plugins. Example: npm.cmd run demo:plugins.
