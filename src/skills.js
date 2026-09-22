import { id, object, jsonCopy } from './config.js';
export function definePlugin(plugin) {
  if (!object(plugin) || !id(plugin.id) || plugin.apiVersion !== 1 || !object(plugin.skills) || !Object.keys(plugin.skills).length || Object.keys(plugin.skills).length > 64) throw new Error('Плагину нужны id, apiVersion: 1 и 1–64 навыка.');
  const requires = plugin.requires ?? [];
  if (!Array.isArray(requires) || !requires.every(id) || new Set(requires).size !== requires.length || requires.includes(plugin.id)) throw new Error('Некорректные зависимости плагина.');
  const skills = {};
  for (const [name, definition] of Object.entries(plugin.skills)) {
    const descriptor = typeof definition === 'function' ? { execute: definition } : definition;
    if (!id(name) || !object(descriptor) || typeof descriptor.execute !== 'function' || (descriptor.validate !== undefined && typeof descriptor.validate !== 'function')) throw new Error(`Неверное описание навыка ${name}.`);
    Object.defineProperty(skills, name, { value: Object.freeze({ execute: descriptor.execute, validate: descriptor.validate }), enumerable: true });
  }
  return Object.freeze({ id: plugin.id, apiVersion: 1, requires: Object.freeze([...requires]), skills: Object.freeze(skills) });
}
export class SkillRegistry {
  #adapterSkills; #skills = new Map(); #plugins = new Map();
  constructor(adapterSkills) { this.#adapterSkills = new Set(adapterSkills); }
  has(name) { return this.#skills.has(name) || this.#adapterSkills.has(name); }
  get(name) { return this.#skills.get(name); }
  register(name, handler, validate) {
    if (!id(name) || typeof handler !== 'function' || (validate !== undefined && typeof validate !== 'function')) throw new TypeError('Навыку нужны имя и функция.');
    if (this.has(name)) throw new Error(`Навык уже зарегистрирован: ${name}`);
    this.#skills.set(name, { execute: handler, validate });
  }
  use(input) {
    const plugin = definePlugin(input);
    if (this.#plugins.has(plugin.id)) throw new Error(`Плагин уже установлен: ${plugin.id}`);
    for (const dependency of plugin.requires) if (!this.#plugins.has(dependency)) throw new Error(`Сначала подключи плагин ${dependency}.`);
    for (const name of Object.keys(plugin.skills)) if (this.has(name)) throw new Error(`Навык уже зарегистрирован: ${name}`);
    // Check everything before registration so a failed install cannot leave half a plugin.
    for (const [name, skill] of Object.entries(plugin.skills)) this.#skills.set(name, skill);
    this.#plugins.set(plugin.id, plugin);
  }
  remove(id) {
    const plugin = this.#plugins.get(id);
    if (!plugin) throw new Error(`Нет плагина ${id}.`);
    if ([...this.#plugins.values()].some(p => p.requires.includes(id))) throw new Error('От этого плагина зависят другие плагины.');
    for (const name of Object.keys(plugin.skills)) this.#skills.delete(name);
    this.#plugins.delete(id);
  }
  snapshot() { return [...this.#plugins.values()].map(p => jsonCopy({ id: p.id, apiVersion: p.apiVersion, requires: p.requires, skills: Object.keys(p.skills) })); }
}
