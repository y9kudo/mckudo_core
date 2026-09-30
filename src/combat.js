import { createDefenseReactor } from './survival.js';
export { weaponProfile, chooseWeapon, combatDecision } from '../packages/kudoconnect/src/combat.js';

export function createCombatReactor(options = {}) {
  const ignoredEntities = options.ignoredEntities ?? ['ender_dragon'];
  if (!Array.isArray(ignoredEntities) || ignoredEntities.some(n => typeof n !== 'string')) throw new Error('ignoredEntities: список имён сущностей.');
  const defense = createDefenseReactor(options);
  return { id: 'mckudo:combat', apiVersion: 1, preempt: true,
    react(observation) {
      const response = defense.react({ ...observation, entities: observation.entities?.filter(e => !ignoredEntities.includes(e.name)) });
      if (!response.action) return response;
      return { ...response, priority: 990, action: { skill: 'combat', args: { ...response.action.args, allowPlayer: options.attackPlayers === true, retreatHealth: options.retreatHealth ?? 8, durationMs: 400 } } };
    }
  };
}
