import { planResources } from './resources.js';
export const cropTypes = Object.freeze({ wheat: { age: 7, seed: 'wheat_seeds' }, carrots: { age: 7, seed: 'carrot' }, potatoes: { age: 7, seed: 'potato' }, beetroots: { age: 3, seed: 'beetroot_seeds' } });
const readyFood = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'cooked_rabbit', 'bread', 'baked_potato', 'carrot', 'apple', 'melon_slice', 'sweet_berries', 'beetroot'];
const meat = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', chicken: 'cooked_chicken', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato' };
const rid = n => 'minecraft:' + n;

export function createFoodReactor({ catalog, foodThreshold = 16, allowHunting = false, huntRadius = 16, replant = true } = {}) {
  if (!Number.isInteger(foodThreshold) || foodThreshold < 1 || foodThreshold > 20 || !Number.isInteger(huntRadius) || huntRadius < 1 || huntRadius > 32 || typeof allowHunting !== 'boolean' || typeof replant !== 'boolean') throw new Error('Неверная политика питания.');
  return { id: 'mckudo:food', apiVersion: 1,
    react(o) {
      if (o.self?.food == null || o.self.food >= foodThreshold) return { action: null, reason: 'Сытость достаточна или неизвестна.' };
      const inventory = o.inventory || {}, action = (skill, args, reason) => ({ priority: 900, action: { skill, args }, reason });
      const food = readyFood.find(n => inventory[rid(n)] > 0);
      if (food) return action('eat', { item: rid(food) }, 'Съесть готовую пищу.');
      const stations = Object.fromEntries(Object.entries(o.world?.nearbyBlocks || {}).filter(([, present]) => present === true).map(([id]) => [id, true]));
      if (catalog) {
        const targets = [...Object.entries(meat).filter(([raw]) => inventory[rid(raw)] > 0).map(([, cooked]) => cooked), 'bread'];
        for (const target of targets) {
          const plan = planResources({ catalog, inventory, targets: { [rid(target)]: 1 }, stations, maxNodes: 300, maxActions: 16 });
          if (plan.status === 'planned' && plan.actions.length) return { priority: 900, action: plan.actions[0].action, reason: `Приготовить ${rid(target)} из доступных припасов.` };
        }
      }
      const crop = (o.world?.crops || []).find(c => c.mature === true && cropTypes[c.name?.replace(/^minecraft:/, '')]);
      if (crop) return action('harvest', { ...crop.position, block: crop.name, replant }, 'Собрать зрелый урожай.');
      const p = o.self?.position;
      const prey = allowHunting && p && (o.entities || []).filter(e => e.kind !== 'player' && ['cow', 'pig', 'chicken', 'sheep', 'rabbit'].includes(e.name) && e.isBaby !== true && e.named !== true && e.position)
        .map(e => ({ ...e, distance: Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z) })).filter(e => e.distance <= huntRadius).sort((a, b) => a.distance - b.distance)[0];
      return prey ? action('hunt', { entityId: prey.id, maxDistance: huntRadius }, 'Добыть пищу охотой по включённой политике.') : { action: null, reason: 'Нет наблюдаемой готовой еды, рецепта, зрелого урожая или разрешённой добычи.' };
    }
  };
}
