import { jsonCopy } from './config.js';
import { resourceId } from './catalog.js';
const pointer = name => '/inventory/' + name.replace(/~/g, '~0').replace(/\//g, '~1');
const integer = (n, min, max, field) => { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${field}: ${min}–${max}.`); };

/** Bounded backward chaining with transactional branches and explicit gathering sources. */
export function planResources({ catalog, targets, inventory = {}, sources = [], stations = {}, fuel = { item: 'minecraft:oak_planks', itemsPerFuel: 1 }, maxDepth = 24, maxNodes = 3000, maxActions = 256 }) {
  integer(maxDepth, 1, 64, 'maxDepth'); integer(maxNodes, 1, 100000, 'maxNodes'); integer(maxActions, 1, 256, 'maxActions');
  const targetMap = Object.fromEntries(Object.entries(jsonCopy(targets)).map(([id, count]) => { integer(count, 1, 4096, 'target'); return [resourceId(id), count]; }));
  if (!Object.keys(targetMap).length || Object.keys(targetMap).length > 32) throw new Error('Нужно 1–32 цели по предметам.');
  const initial = Object.fromEntries(Object.entries(jsonCopy(inventory)).map(([id, count]) => { integer(count, 0, 1000000, 'inventory'); return [resourceId(id), count]; }));
  const knownSources = jsonCopy(sources).map(s => ({ ...s, item: resourceId(s.item), block: resourceId(s.block), tools: (s.tools || []).map(resourceId) }));
  const stationData = jsonCopy(stations), fuelData = jsonCopy(fuel);
  resourceId(fuelData.item); if (!Number.isFinite(fuelData.itemsPerFuel) || fuelData.itemsPerFuel <= 0 || fuelData.itemsPerFuel > 100) throw new Error('Неверная ёмкость топлива.');
  let visited = 0, lastReason = '', bounded = false;
  const note = reason => { lastReason = reason; return null; };
  const append = (s, action, output) => {
    if (s.actions.length >= maxActions) { bounded = true; return false; }
    s.actions.push({ action, ...(output ? { until: { fact: pointer(output), gte: s.inventory[output] + (s.reserved[output] || 0) + (s.pending[output] || 0) } } : {}) }); return true;
  };
  const take = (s, item, count) => { s.inventory[item] = (s.inventory[item] || 0) - count; };
  const ensureStation = (s, name, stack) => {
    if (!name || s.stations.includes(name)) return s;
    const slot = stationData[name];
    if (!slot || !['x', 'y', 'z'].every(k => Number.isInteger(slot[k]))) return note(`Нужно место для станции ${name}.`);
    const prepared = ensure(s, name, 1, stack); if (!prepared) return null;
    take(prepared, name, 1); prepared.stations.push(name);
    if (!append(prepared, { skill: 'place', args: { block: name, ...slot } })) return null;
    return prepared;
  };
  const ensure = (state, item, amount, stack = []) => {
    if ((state.inventory[item] || 0) >= amount) return state;
    if (++visited > maxNodes || stack.length >= maxDepth) { bounded = true; return note('Исчерпан бюджет поиска ресурсов.'); }
    if (stack.includes(item)) return note(`Цикл получения ${item}.`);
    if (!catalog.item(item)) return note(`Неизвестный предмет ${item}.`);
    const nextStack = [...stack, item];
    for (const source of knownSources.filter(s => s.item === item)) {
      let branch = structuredClone(state);
      if (source.tools.length && !source.tools.some(t => branch.inventory[t] > 0)) {
        let tool;
        for (const t of source.tools) { tool = ensure(structuredClone(branch), t, 1, nextStack); if (tool) break; }
        if (!tool) continue; branch = tool;
      }
      let left = amount - (branch.inventory[item] || 0);
      while (left > 0) {
        const count = Math.min(16, left); branch.inventory[item] = (branch.inventory[item] || 0) + count;
        if (!append(branch, { skill: 'gather', args: { block: source.block, count } }, item)) return null;
        left -= count;
      }
      return branch;
    }
    const recipes = catalog.recipesFor(item).filter(r => r.executable).sort((a, b) => {
      const score = r => r.ingredients.reduce((n, g) => n + (g.choices.some(i => state.inventory[i] > 0) ? 0 : 1), 0);
      return score(a) - score(b);
    });
    for (const recipe of recipes) {
      if (bounded && visited > maxNodes) break;
      let branch = ensureStation(structuredClone(state), recipe.station, nextStack); if (!branch) continue;
      const times = Math.ceil((amount - (branch.inventory[item] || 0)) / recipe.output.count), selected = {};
      for (const group of recipe.ingredients) {
        let found = null, chosen;
        const choices = [...group.choices].sort((a, b) => (branch.inventory[b] || 0) - (branch.inventory[a] || 0));
        for (const ingredient of choices) {
          const candidate = ensure(structuredClone(branch), ingredient, group.count * times, nextStack);
          if (candidate) { found = candidate; chosen = ingredient; break; }
        }
        if (!found) { branch = null; break; }
        branch = found; take(branch, chosen, group.count * times); branch.pending[chosen] = (branch.pending[chosen] || 0) + group.count * times; selected[chosen] = (selected[chosen] || 0) + group.count;
      }
      if (!branch) continue;
      if (recipe.type === 'minecraft:smelting') {
        const ingredients = Object.keys(selected); if (ingredients.length !== 1) continue;
        const fuelCount = Math.ceil(times / fuelData.itemsPerFuel);
        branch = ensure(branch, resourceId(fuelData.item), fuelCount, nextStack); if (!branch) continue;
        take(branch, resourceId(fuelData.item), fuelCount);
        for (const [input, n] of Object.entries(selected)) branch.pending[input] -= n * times;
        branch.inventory[item] = (branch.inventory[item] || 0) + recipe.output.count * times;
        if (!append(branch, { skill: 'smelt', args: { input: ingredients[0], item, count: times, fuel: resourceId(fuelData.item), fuelCount } }, item)) continue;
      } else {
        let left = times;
        while (left > 0) {
          const batch = Math.min(16, left); branch.inventory[item] = (branch.inventory[item] || 0) + batch * recipe.output.count;
          for (const [input, n] of Object.entries(selected)) branch.pending[input] -= n * batch;
          if (!append(branch, { skill: 'craft', args: { item, times: batch, ingredients: selected } }, item)) { branch = null; break; }
          left -= batch;
        }
      }
      if (branch) return branch;
    }
    return note(`Нет доступной цепочки для ${item}. ${lastReason}`.slice(0, 500));
  };
  let state = { inventory: initial, reserved: {}, pending: {}, stations: Object.keys(stationData).filter(k => stationData[k] === true), actions: [] };
  // Reserve already requested results so later recipes cannot consume an earlier target.
  const reserved = {};
  for (const [item, count] of Object.entries(targetMap)) {
    state = ensure(state, item, count); if (!state) return { status: 'blocked', reason: bounded ? 'Исчерпан бюджет поиска ресурсов.' : lastReason, actions: [], visited };
    take(state, item, count); reserved[item] = count; state.reserved[item] = count;
  }
  for (const [item, count] of Object.entries(reserved)) state.inventory[item] += count;
  return { status: 'planned', reason: 'Цепочка рассчитана по каталогу и доступным источникам.', actions: state.actions, inventoryAfter: state.inventory, stations: state.stations, visited };
}

export function resourceWorkflow(id, plan, { priority = 10 } = {}) {
  if (plan.status !== 'planned' || !plan.actions.length || plan.actions.length > 64) throw new Error('Workflow требует готовый план из 1–64 действий; большие планы выполняй порциями.');
  return { id, priority, steps: plan.actions.map((s, i) => ({ id: `resource-${i + 1}`, ...s, maxAttempts: 2 })) };
}
