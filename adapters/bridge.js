import { randomUUID } from 'node:crypto';
import { jsonCopy, id } from '../src/config.js';

// Transport contract for a separately implemented game-side mod. This is not a Forge/NeoForge mod.
export async function createBridgeAdapter({ transport, expectedLoader }) {
  if (!['forge', 'neoforge', 'fabric'].includes(expectedLoader)) throw new Error("Specify expectedLoader: forge, neoforge or fabric.");
  for (const method of ['describe', 'observe', 'execute', 'cancel']) if (typeof transport?.[method] !== 'function') throw new Error(`Bridge transport must implement ${method}().`);
  const description = jsonCopy(await transport.describe());
  if (description.protocolVersion !== 1 || description.loader !== expectedLoader || typeof description.minecraftVersion !== 'string' || !description.minecraftVersion || !Array.isArray(description.skills) || !description.skills.every(id)) throw new Error("Bridge: incompatible protocol, loader or skill list.");
  let quarantined = false;
  return {
    describe: () => jsonCopy({ ...description, kind: 'mod-bridge' }),
    observe: async ({ signal }) => {
      if (quarantined) throw new Error("Bridge: Stop not confirmed. New connection required.");
      signal.throwIfAborted(); const result = await transport.observe({ signal }); signal.throwIfAborted(); return jsonCopy(result);
    },
    execute: async (action, { signal }) => {
      signal.throwIfAborted();
      if (quarantined) throw new Error("Bridge locked until reconnect.");
      if (!description.skills.includes(action.skill)) throw new Error("Bridge I didn't declare this skill.");
      const requestId = randomUUID(); let cancellation;
      const cancel = () => {
        cancellation = Promise.resolve().then(() => transport.cancel({ requestId })).then(reply => {
          if (reply?.stopped !== true) quarantined = true;
        }, () => { quarantined = true; });
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        // Execute must settle only after the game-side action is finished or stopped.
        // We deliberately do not race it against the signal and risk overlapping remote actions.
        const result = await transport.execute({ requestId, action: jsonCopy(action) });
        if (cancellation) await cancellation;
        signal.throwIfAborted(); return jsonCopy(result);
      } catch (error) {
        if (!signal.aborted) quarantined = true; // Lost transport acknowledgement is not proof the remote action stopped.
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
        if (cancellation) await cancellation;
      }
    },
  };
}
