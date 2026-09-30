/** KudoConnect Agent Contract v1: all values are observed; absent inventory counts are zero. */
export function observeAgent(c) {
  if (!c.state.position) throw new Error('Позиция ещё не получена.');
  const entities = [...c.entities.values()].map(e => ({ id: e.id, name: e.name, kind: e.kind, position: { ...e.position }, velocity: { ...e.velocity }, health: e.metadata?.health ?? null, isBaby: e.metadata?.baby === true || e.metadata?.is_baby === true, named: e.metadata?.custom_name != null }));
  return structuredClone({ contract: 'kudoconnect.agent', version: 1, minecraftVersion: c.options.version,
    self: { ...c.state, freeInventorySlots: c.inventory.slots.slice(9,45).filter(i => !i).length }, inventory: c.inventory.snapshot(), equipment:c.inventory.equipment(), entities, players: c.players.snapshot(), attention: c.attention.last, storage: [...c.containers.observations.values()],
    time:c.time,endgame:c.endgame,world: { dimension: c.state.dimension, revision: c.world.revision, loadedChunks: c.world.columns.size },
    combat: { attackers: [...c.attackers.values()].filter(a => Date.now() - a.lastHitAt < 10000) },
    drops: [...c.entities.values()].filter(e => e.name === 'item' && e.item).map(e => ({ id: e.id, item: e.item.item || 'minecraft:' + e.item.name, count: e.item.count, position: { ...e.position } })) });
}
