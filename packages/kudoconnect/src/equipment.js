export function remainingDurability(item, registry) {
  const maximum = registry.items[item?.type]?.maxDurability;
  if (!maximum) return Infinity;
  const damage = item.raw?.components?.find(c => c.type === 'damage')?.data ?? 0;
  return maximum - damage;
}
export function miningTime(registry, block, item, { onGround = true } = {}) {
  if (!block.diggable || block.hardness < 0) throw new Error('Этот блок нельзя добывать.');
  const harvestable = !block.harvestTools || Object.hasOwn(block.harvestTools, item?.type);
  const speed = Math.max(1, ...(block.material || '').split(';').filter(s => !s.startsWith('incorrect_for_')).map(s => registry.materials[s]?.[item?.type] || 1));
  const ticks = block.hardness === 0 ? 1 : Math.ceil(block.hardness * (harvestable ? 30 : 100) / speed * (onGround ? 1 : 5));
  return { milliseconds: (ticks + 1) * 50, harvestable };
}
export function chooseMiningTool(registry, block, items, { held = null, onGround = true, preservePickaxeTier } = {}) {
  if(preservePickaxeTier!==undefined&&(!Number.isInteger(preservePickaxeTier)||preservePickaxeTier<1||preservePickaxeTier>4))throw new Error('preservePickaxeTier: 1–4.');
  const candidates = [null, ...items.filter(i => remainingDurability(i, registry) > 1)].map(item => ({ item, ...miningTime(registry, block, item, { onGround }) })).filter(t => t.harvestable);
  const material = String(block.material || ''), blockName = String(block.name || '');
  const family = /(?:dirt|grass|sand|gravel|clay|snow|mud|podzol|mycelium|farmland)/.test(material+';'+blockName) ? 'shovel'
    : /(?:wood|log|stem|hyphae)/.test(material+';'+blockName) ? 'axe'
    : /(?:stone|ore|deepslate|metal)/.test(material+';'+blockName) ? 'pickaxe' : null;
  // A held pickaxe must not win a tie on soil: save its durability for stone.
  const suited = family ? candidates.filter(t => t.item?.name?.endsWith('_'+family)) : [];
  if (suited.length) candidates.splice(0,candidates.length,...suited);
  else if (family === 'shovel' && candidates.some(t => t.item === null)) candidates.splice(0,candidates.length,...candidates.filter(t => t.item === null));
  const tier=item=>['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'].indexOf(item?.name?.replace(/^minecraft:/,''));
  const ordinary=preservePickaxeTier===undefined?[]:candidates.filter(t=>tier(t.item)<preservePickaxeTier);
  const selected=ordinary.length?ordinary:candidates;
  selected.sort((a,b) => a.milliseconds - b.milliseconds || Number(b.item?.slot === held?.slot) - Number(a.item?.slot === held?.slot));
  return selected[0] ?? null;
}
