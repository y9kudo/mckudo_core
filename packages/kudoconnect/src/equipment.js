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
export function chooseMiningTool(registry, block, items, { held = null, onGround = true } = {}) {
  const candidates = [null, ...items.filter(i => remainingDurability(i, registry) > 0)].map(item => ({ item, ...miningTime(registry, block, item, { onGround }) })).filter(t => t.harvestable);
  candidates.sort((a,b) => a.milliseconds - b.milliseconds || Number(b.item?.slot === held?.slot) - Number(a.item?.slot === held?.slot));
  return candidates[0] ?? null;
}
