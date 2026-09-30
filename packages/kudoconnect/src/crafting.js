import { isAir, isFullBlock } from './navigation.js';

const EMPTY = { itemCount: 0 };
const id = value => {
  if (typeof value !== 'string' || !/^(minecraft:)?[a-z0-9_]+$/.test(value)) throw new Error('Нужен vanilla ID предмета.');
  return value.replace(/^minecraft:/, '');
};
const integer = (value, min, max, field) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field}: ${min}–${max}.`); return value; };
const live = (c, signal) => { signal?.throwIfAborted(); if (c.state.health <= 0 || c.state.status !== 'ready') throw new Error('Агент недоступен.'); };
const plain = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a, b) => JSON.stringify(a?.raw || null) === JSON.stringify(b?.raw || null);
const quantity = slot => slot?.count || 0;
// These vanilla recipes explicitly accept the planks tag. A block class alone is
// never sufficient to substitute ingredients in a species-specific recipe.
const mixedPlankOutputs = new Set(['crafting_table', 'stick', 'chest', 'barrel', 'shield', 'wooden_pickaxe', 'wooden_axe', 'wooden_sword', 'wooden_shovel', 'wooden_hoe', 'bookshelf', 'piston', 'tripwire_hook', 'loom', 'cartography_table', 'fletching_table', 'smithing_table', 'beehive', 'chiseled_bookshelf']);
const stoneMaterials = new Set(['cobblestone', 'blackstone', 'cobbled_deepslate']);

/** Return executable static recipes from the installed, version-pinned registry. */
export function craftingRecipes(registry, item) {
  item = id(item); const output = registry.itemsByName[item];
  if (!output) throw new Error(`Неизвестный предмет ${item}.`);
  const recipes = [];
  for (const recipe of registry.recipes[output.id] || []) {
    if (recipe.outShape || recipe.outIngredients || !recipe.result || recipe.result.id !== output.id) continue;
    const shape = recipe.inShape || [recipe.ingredients || []], shaped = Boolean(recipe.inShape);
    const width = shaped ? Math.max(...shape.map(r => r.length)) : shape[0].length <= 4 ? 2 : 3;
    const height = shaped ? shape.length : Math.ceil(shape[0].length / width);
    if (width > 3 || height > 3 || !width || !height) continue;
    const cells = [], source = shaped ? shape.flatMap((row, y) => row.map((value, x) => ({ value, x, y }))) : shape[0].map((value, n) => ({ value, x: n % width, y: Math.floor(n / width) }));
    let supported = true;
    for (const { value, x, y } of source) {
      const numeric = typeof value === 'object' && value !== null ? value.id : value;
      if (numeric == null || numeric < 0) continue;
      const name = registry.items[numeric]?.name;
      if (!name || /_bucket$/.test(name) || name === 'honey_bottle' || typeof value === 'object' && (value.count ?? 1) !== 1) { supported = false; break; }
      let choices = [name];
      if ((mixedPlankOutputs.has(item)||item.endsWith('_bed')) && name.endsWith('_planks')) choices = registry.itemsArray.filter(i => i.name.endsWith('_planks')).map(i => i.name);
      if ((item === 'furnace' || /^stone_(pickaxe|axe|shovel|hoe|sword)$/.test(item)) && stoneMaterials.has(name)) choices = [...stoneMaterials].filter(n => registry.itemsByName[n]);
      cells.push({ x, y, choices });
    }
    if (supported && cells.length) recipes.push({ item, count: recipe.result.count, width, height, table: width > 2 || height > 2, cells });
  }
  return recipes.filter((r, n, all) => all.findIndex(v => JSON.stringify(v) === JSON.stringify(r)) === n);
}

/** Select alternatives per slot while respecting every already reserved item. */
export function chooseCraftingRecipe(registry, item, inventory, { ingredients } = {}) {
  const available = Object.fromEntries(Object.entries(inventory).map(([name, n]) => [id(name), n]));
  let allowed;
  if (ingredients !== undefined) {
    if (!ingredients || typeof ingredients !== 'object' || Array.isArray(ingredients)) throw new Error('ingredients: карта предметов и количеств.');
    allowed = Object.fromEntries(Object.entries(ingredients).map(([name, n]) => [id(name), integer(n, 1, 64, 'ingredients')]));
  }
  for (const recipe of craftingRecipes(registry, item).sort((a, b) => Number(a.table) - Number(b.table) || b.count - a.count)) {
    const remaining = { ...available }, limits = allowed && { ...allowed }, selected = [];
    for (const cell of [...recipe.cells].sort((a, b) => a.choices.length - b.choices.length)) {
      const choice = cell.choices.filter(n => remaining[n] > 0 && (!limits || limits[n] > 0)).sort((a, b) => remaining[b] - remaining[a])[0];
      if (!choice) break;
      remaining[choice]--; if (limits) limits[choice]--; selected.push({ x: cell.x, y: cell.y, item: choice });
    }
    if (selected.length === recipe.cells.length) return { ...recipe, cells: selected };
  }
  return null;
}

function menu(c, window = null) {
  const assert = () => { if (window ? c.containers.current !== window || !window.ready : c.containers.current) throw new Error('Сервер закрыл или заменил окно.'); };
  return { id: window?.id || 0, assert, slots: () => { assert(); return window ? window.slots : c.inventory.slots; },
    revision: () => window ? c.containers.revision : c.inventory.revision,
    event: window ? 'container' : 'inventory', playerStart: window ? window.topSlots ?? window.storageSlots : 9 };
}

async function click(c, m, slot, button, mode, signal, confirmed) {
  live(c, signal); m.assert(); const revision = m.revision();
  // Vanilla assumes client prediction for normal clicks. Deliberately mismatched
  // state requests a complete authoritative response, including the cursor.
  c.write('window_click', { windowId: m.id, stateId: -1, slot, mouseButton: button, mode, changedSlots: [], cursorItem: EMPTY });
  await c.waitFor(() => { m.assert(); return m.revision() > revision && confirmed(); }, { signal, event: m.event, timeoutMs: 4000 });
}

async function moveOne(c, m, source, target, signal) {
  if (c.inventory.cursor) throw new Error('Курсор занят: нужен подтверждённый пустой курсор.');
  const original = m.slots()[source], previous = m.slots()[target];
  if (!original || previous && previous.name !== original.name) throw new Error('Слоты ингредиентов изменились.');
  await click(c, m, source, 0, 0, signal, () => !m.slots()[source] && same(c.inventory.cursor, original));
  await click(c, m, target, 1, 0, signal, () => m.slots()[target]?.name === original.name && quantity(m.slots()[target]) === quantity(previous) + 1 && quantity(c.inventory.cursor) === original.count - 1);
  if (c.inventory.cursor) await click(c, m, source, 0, 0, signal, () => !c.inventory.cursor && m.slots()[source]?.name === original.name && quantity(m.slots()[source]) === original.count - 1);
}

async function withdraw(c, m, slot, signal) {
  const source = m.slots()[slot]; if (!source) return;
  if (c.containers.capacity(source) < source.count) throw new Error('В инвентаре недостаточно места для результата.');
  const before = c.inventory.count(source.name);
  await click(c, m, slot, 0, 1, signal, () => !m.slots()[slot] && c.inventory.count(source.name) >= before + source.count && !c.inventory.cursor);
}

async function closeMenu(c, window, signal) {
  if (!window) return;
  try { if (c.client?.state === 'play') c.write('close_window', { windowId: window.id }); }
  finally { c.containers.close(window.id); c.containerRequest = false; }
  // Closing returns the crafting grid and carried stack on the server. Request
  // inventory 0 afterwards so cancellation cannot leave a fabricated local state.
  if (c.client?.state === 'play' && c.state.health > 0) {
    if (signal?.aborted) c.write('window_click', { windowId: 0, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: EMPTY });
    else { const m = menu(c); await click(c, m, -999, 0, 0, signal, () => !c.inventory.cursor); }
  }
}

async function openStation(c, station, position, signal, runtime) {
  if (c.containers.current || c.inventory.cursor) throw new Error('Сначала закрой окно и освободи курсор.');
  await runtime.approach(c, position, signal);
  if (c.world.blockAt(position)?.name !== station) throw new Error('Рабочая станция изменилась.');
  c.stopMovement(); c.lookAt({ x: position.x + .5, y: position.y + .5, z: position.z + .5 });
  await c.waitForLook?.({ signal }); c.containerRequest = true;
  try {
    c.write('block_place', { hand: 0, location: position, direction: 1, cursorX: .5, cursorY: .5, cursorZ: .5, insideBlock: false, sequence: ++c.sequence });
    await c.waitFor(() => c.containers.current?.ready === true, { signal, event: 'container', timeoutMs: 4000 });
    const window = c.containers.current, expected = station === 'crafting_table' ? 12 : 14;
    if (window.type !== expected) throw new Error('Открылась другая рабочая станция.');
    return window;
  } catch (error) { await closeMenu(c, c.containers.current, signal).catch(() => {}); c.containerRequest = false; throw error; }
}

/** count is new output items; times is the legacy recipe-repetition API. */
export async function craft(c, args, signal, runtime) {
  const item = id(args.item), requested = integer(args.count ?? 1, 1, 256, 'craft.count');
  if (args.times !== undefined) { integer(args.times, 1, 64, 'craft.times'); if (args.count !== undefined) throw new Error('Укажи count или times, не оба.'); }
  if (c.containers.current || c.inventory.cursor) throw new Error('Перед крафтом закрой окно и освободи курсор.');
  let completed = 0, produced = 0, window;
  try {
    while (args.times !== undefined ? completed < args.times : produced < requested) {
      live(c, signal);
      let recipe = chooseCraftingRecipe(c.registry, item, c.inventory.snapshot(), args);
      if (!recipe) throw new Error(`Недостаточно ингредиентов или нет поддерживаемого рецепта ${item}.`);
      if (recipe.table && !window) {
        const station = await ensureStation(c, { station: 'crafting_table', gather: args.gather !== false }, signal, runtime);
        // Making a missing station may have consumed some of the same planks.
        recipe = chooseCraftingRecipe(c.registry, item, c.inventory.snapshot(), args);
        if (!recipe) throw new Error(`После подготовки станции не хватает ингредиентов ${item}.`);
        window = await openStation(c, 'crafting_table', station.position, signal, runtime);
      }
      const m = menu(c, window), gridSize = window ? 9 : 4, width = window ? 3 : 2;
      if (m.slots().slice(0, gridSize + 1).some(Boolean)) throw new Error('Сетка крафта занята; чужие предметы не расходуются.');
      const expected = { name: item, count: recipe.count, raw: { components: [], removeComponents: [] } };
      if (c.containers.capacity(expected) < recipe.count) throw new Error('Недостаточно места для результата крафта.');
      for (const cell of recipe.cells) {
        const source = m.slots().findIndex((s, n) => n >= m.playerStart && n < m.playerStart + 36 && s?.name === cell.item);
        if (source < 0) throw new Error(`Пропал ингредиент ${cell.item}.`);
        await moveOne(c, m, source, 1 + cell.y * width + cell.x, signal);
      }
      await c.waitFor(() => m.slots()[0]?.name === item && m.slots()[0]?.count === recipe.count, { signal, event: m.event, timeoutMs: 4000 });
      const before = c.inventory.count(item);
      await click(c, m, 0, 0, 1, signal, () => c.inventory.count(item) >= before + recipe.count && m.slots().slice(0, gridSize + 1).every(s => !s) && !c.inventory.cursor);
      produced += c.inventory.count(item) - before; completed++;
    }
    return { ok: true, serverConfirmed: true, item: 'minecraft:' + item, produced, times: completed };
  } finally {
    if (window) await closeMenu(c, window, signal);
    else if (c.client?.state === 'play' && (c.inventory.cursor || c.inventory.slots.slice(1, 5).some(Boolean))) {
      // Vanilla closing inventory zero returns its grid/cursor without discards.
      c.write('close_window', { windowId: 0 });
      c.write('window_click', { windowId: 0, stateId: -1, slot: -999, mouseButton: 0, mode: 0, changedSlots: [], cursorItem: EMPTY });
    }
  }
}

export async function ensurePlanks(c, count, signal, runtime) {
  const total = () => c.inventory.items().filter(s => s.name.endsWith('_planks')).reduce((n, s) => n + s.count, 0);
  for (let attempt = 0; total() < count && attempt < 16; attempt++) {
    let log = c.inventory.items().find(s => /(_log|_stem)$/.test(s.name));
    if (!log) { await runtime.run(c, { skill: 'gather', args: { block: '#logs', count: 1 } }, signal); log = c.inventory.items().find(s => /(_log|_stem)$/.test(s.name)); }
    if (!log) throw new Error('Добыча не принесла древесины.');
    const output = c.registry.itemsArray.find(i => i.name.endsWith('_planks') && craftingRecipes(c.registry, i.name).some(r => r.cells.some(cell => cell.choices.includes(log.name))));
    if (!output) throw new Error(`Нет рецепта досок из ${log.name}.`);
    await craft(c, { item: output.name, count: 1 }, signal, runtime);
  }
  if (total() < count) throw new Error('Исчерпан бюджет подготовки досок.');
}

/** Reuse a reachable station; otherwise gather, craft and place one nearby. */
export async function ensureStation(c, args, signal, runtime) {
  const station = id(args.station || args.item), gather = args.gather !== false;
  if (!['crafting_table', 'furnace'].includes(station)) throw new Error('ensureStation: crafting_table или furnace.');
  live(c, signal);
  const found = await c.world.findBlocks({ names: [station], position: c.state.position, radius: 64, count: 12, signal });
  for (const candidate of found.blocks) {
    try { await runtime.approach(c, candidate.position, signal); return { ok: true, station: 'minecraft:' + station, position: candidate.position, created: false }; }
    catch { signal?.throwIfAborted(); }
  }
  if (!c.inventory.count(station)) {
    if (gather && station === 'crafting_table') await ensurePlanks(c, 4, signal, runtime);
    if (gather && station === 'furnace') {
      await ensureStation(c, { station: 'crafting_table' }, signal, runtime);
      if (!c.inventory.items().some(i => /^(wooden|stone|iron|golden|diamond|netherite)_pickaxe$/.test(i.name))) {
        await ensurePlanks(c, 5, signal, runtime);
        if (c.inventory.count('stick') < 2) await craft(c, { item: 'stick', count: 2 }, signal, runtime);
        await craft(c, { item: 'wooden_pickaxe', count: 1 }, signal, runtime);
      }
      const stone = () => c.inventory.items().filter(i => stoneMaterials.has(i.name)).reduce((n, s) => n + s.count, 0);
      for (let attempts = 0; stone() < 8 && attempts < 8; attempts++) await runtime.run(c, { skill: 'gather', args: { block: 'stone', item: 'cobblestone', count: 1 } }, signal);
    }
    await craft(c, { item: station, count: 1, gather }, signal, runtime);
  }
  const origin = plain(c.state.position), positions = [];
  for (let y = origin.y - 1; y <= origin.y + 1; y++) for (let x = origin.x - 3; x <= origin.x + 3; x++) for (let z = origin.z - 3; z <= origin.z + 3; z++) {
    const p = { x, y, z };
    if (x === origin.x && z === origin.z || !isAir(c.world.blockAt(p)) || !isFullBlock(c.world.blockAt({ ...p, y: y - 1 }))) continue;
    if ([...c.entities.values()].some(e => e.position && distance(e.position, { x: x + .5, y, z: z + .5 }) < 1.2)) continue;
    positions.push(p);
  }
  positions.sort((a, b) => distance(a, c.state.position) - distance(b, c.state.position)); let lastError;
  for (const position of positions) {
    try {
      await runtime.run(c, { skill: 'place', args: { block: station, ...position } }, signal);
      return { ok: true, serverConfirmed: true, station: 'minecraft:' + station, position, created: true };
    } catch (error) { signal?.throwIfAborted(); lastError = error; if (!c.inventory.count(station)) throw error; }
  }
  throw lastError || new Error('Нет свободного безопасного места для рабочей станции.');
}

const smeltingInputs = {
  iron_ingot: ['raw_iron', 'iron_ore', 'deepslate_iron_ore'], gold_ingot: ['raw_gold', 'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'], copper_ingot: ['raw_copper', 'copper_ore', 'deepslate_copper_ore'],
  stone: ['cobblestone'], smooth_stone: ['stone'], glass: ['sand', 'red_sand'], brick: ['clay_ball'], nether_brick: ['netherrack'],
  cooked_beef: ['beef'], cooked_porkchop: ['porkchop'], cooked_chicken: ['chicken'], cooked_mutton: ['mutton'], cooked_rabbit: ['rabbit'], cooked_cod: ['cod'], cooked_salmon: ['salmon'], baked_potato: ['potato'], dried_kelp: ['kelp'],
};
export function smeltingRecipe(registry, item) {
  item = id(item);
  const inputs = item === 'charcoal' ? registry.itemsArray.filter(i => /(_log|_wood|_stem|_hyphae)$/.test(i.name) && !/crimson|warped/.test(i.name)).map(i => i.name) : smeltingInputs[item];
  return inputs && registry.itemsByName[item] ? { item, inputs, ticks: 200 } : null;
}
export function fuelItems(item) { return /crimson|warped/.test(item) ? 0 : ['coal', 'charcoal'].includes(item) ? 8 : item === 'coal_block' ? 80 : /_(planks|log|wood)$/.test(item) ? 1.5 : item === 'stick' ? .5 : 0; }
const furnaceReservations = new Set();

export async function smelt(c, args, signal, runtime) {
  const item = id(args.item), count = integer(args.count ?? 1, 1, 64, 'smelt.count'), recipe = smeltingRecipe(c.registry, item);
  if (!recipe) throw new Error(`Плавка ${item} пока не поддерживается.`);
  const input = args.input ? id(args.input) : recipe.inputs.find(n => c.inventory.count(n) >= count);
  if (!recipe.inputs.includes(input) || c.inventory.count(input) < count) throw new Error('Не хватает подходящего сырья для плавки.');
  const fuel = args.fuel ? id(args.fuel) : c.inventory.items().filter(i => fuelItems(i.name) * i.count >= count).sort((a, b) => fuelItems(b.name) - fuelItems(a.name))[0]?.name;
  const fuelCount = args.fuelCount ?? Math.ceil(count / fuelItems(fuel || ''));
  if (!fuel || !fuelItems(fuel) || !Number.isInteger(fuelCount) || fuelCount < 1 || fuelCount > 64 || fuelItems(fuel) * fuelCount < count || c.inventory.count(fuel) < fuelCount + (fuel === input ? count : 0)) throw new Error('Недостаточно топлива для всей партии плавки.');
  const station = await ensureStation(c, { station: 'furnace', gather: args.gather !== false }, signal, runtime);
  if (c.inventory.count(input) < count || c.inventory.count(fuel) < fuelCount + (fuel === input ? count : 0)) throw new Error('Подготовка станции израсходовала необходимые материалы.');
  const key = `${c.options.host}:${c.options.port}:${c.state.dimension}:${station.position.x},${station.position.y},${station.position.z}`;
  // Wait for a local user of the same furnace instead of repeatedly failing/replanning.
  while(furnaceReservations.has(key)){live(c,signal);await new Promise((resolve,reject)=>{const timer=setTimeout(done,100);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);};function done(){signal?.removeEventListener('abort',abort);resolve();}signal?.addEventListener('abort',abort,{once:true});});}
  furnaceReservations.add(key); let window;
  try {
    window = await openStation(c, 'furnace', station.position, signal, runtime); const m = menu(c, window);
    if (m.slots().slice(0, 3).some(Boolean)) throw new Error('Печь занята: существующие предметы не расходуются.');
    for (const [name, amount, slot] of [[input, count, 0], [fuel, fuelCount, 1]]) for (let n = 0; n < amount; n++) {
      const source = m.slots().findIndex((s, index) => index >= m.playerStart && index < m.playerStart + 36 && s?.name === name);
      if (source < 0) throw new Error(`Пропал предмет ${name}.`);
      await moveOne(c, m, source, slot, signal);
    }
    let produced = 0; const deadline = Date.now() + count * 11000 + 10000;
    while (produced < count) {
      live(c, signal);
      await c.waitFor(() => m.slots()[2]?.name === item, { event: 'container', signal, timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())) });
      const before = c.inventory.count(item); await withdraw(c, m, 2, signal); produced += c.inventory.count(item) - before;
      if (Date.now() >= deadline && produced < count) throw new Error('Истёк бюджет плавки.');
    }
    // Unburnt fuel remains owned by this bot. Burning fuel cannot be recovered.
    if (m.slots()[1]) await withdraw(c, m, 1, signal);
    return { ok: true, serverConfirmed: true, item: 'minecraft:' + item, produced, station: station.position };
  } finally { try { await closeMenu(c, window, signal); } finally { furnaceReservations.delete(key); } }
}
