import {isAir, isFullBlock, isHazard} from './navigation.js';

/** Carve a two-cell side alcove without touching the player's support or valuables. */
export function workstationAlcoves({position, getBlock, canDig, occupied = () => false}) {
  const feet = {x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z)};
  const sites = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const target = {x: feet.x + dx, y: feet.y, z: feet.z + dz};
    if (occupied(target) || !isFullBlock(getBlock({...target, y: target.y - 1}))) continue;
    const cells = [{...target, y: target.y + 1}, target];
    const dig = cells.filter(p => !isAir(getBlock(p)));
    if (!dig.length || dig.some(p => {
      const block = getBlock(p);
      if (!block || !canDig(block, p)) return true;
      // Never open an unknown wall, a liquid or unsupported gravity blocks.
      return [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => {
        const neighbor = getBlock({x: p.x + x, y: p.y + y, z: p.z + z});
        return !neighbor || isHazard(neighbor) || y === 1 && /(?:sand|gravel|concrete_powder|anvil|dripstone)$/.test(neighbor.name);
      });
    })) continue;
    sites.push({position: target, dig});
  }
  return sites.sort((a, b) => a.dig.length - b.dig.length);
}
