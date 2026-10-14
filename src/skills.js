import { id, object, jsonCopy } from './config.js';
export function definePlugin(plugin) {
  if (!object(plugin) || !id(plugin.id) || plugin.apiVersion !== 1 || !object(plugin.skills) || !Object.keys(plugin.skills).length || Object.keys(plugin.skills).length > 64) throw new Error("Plagin needs it id, apiVersion: 1 and 1–64 Skills.");
  const requires = plugin.requires ?? [];
  if (!Array.isArray(requires) || !requires.every(id) || new Set(requires).size !== requires.length || requires.includes(plugin.id)) throw new Error("Uncorrect Plagin Dependence.");
  const skills = {};
  for (const [name, definition] of Object.entries(plugin.skills)) {
    const descriptor = typeof definition === 'function' ? { execute: definition } : definition;
    if (!id(name) || !object(descriptor) || typeof descriptor.execute !== 'function' || (descriptor.validate !== undefined && typeof descriptor.validate !== 'function')) throw new Error(`Uncorrect description of skills ${name}.`);
    Object.defineProperty(skills, name, { value: Object.freeze({ execute: descriptor.execute, validate: descriptor.validate }), enumerable: true });
  }
  return Object.freeze({ id: plugin.id, apiVersion: 1, requires: Object.freeze([...requires]), skills: Object.freeze(skills) });
}
export class SkillRegistry {
  #adapterSkills; #skills = new Map(); #plugins = new Map();
  constructor(adapterSkills) { this.#adapterSkills = new Set(adapterSkills); }
  has(name) { return this.#skills.has(name) || this.#adapterSkills.has(name); }
  names() { return [...new Set([...this.#adapterSkills, ...this.#skills.keys()])].sort(); }
  get(name) { return this.#skills.get(name); }
  register(name, handler, validate) {
    if (!id(name) || typeof handler !== 'function' || (validate !== undefined && typeof validate !== 'function')) throw new TypeError("Skills needs a name and function.");
    if (this.has(name)) throw new Error(`Skills already registered: ${name}`);
    this.#skills.set(name, { execute: handler, validate });
  }
  use(input) {
    const plugin = definePlugin(input);
    if (this.#plugins.has(plugin.id)) throw new Error(`Plagin already installed: ${plugin.id}`);
    for (const dependency of plugin.requires) if (!this.#plugins.has(dependency)) throw new Error(`First, plug in the plagin ${dependency}.`);
    for (const name of Object.keys(plugin.skills)) if (this.has(name)) throw new Error(`Skills already registered: ${name}`);
    // Check everything before registration so a failed install cannot leave half a plugin.
    for (const [name, skill] of Object.entries(plugin.skills)) this.#skills.set(name, skill);
    this.#plugins.set(plugin.id, plugin);
  }
  remove(id) {
    const plugin = this.#plugins.get(id);
    if (!plugin) throw new Error(`No plagin ${id}.`);
    if ([...this.#plugins.values()].some(p => p.requires.includes(id))) throw new Error("Dependent plugins prevent removal.");
    for (const name of Object.keys(plugin.skills)) this.#skills.delete(name);
    this.#plugins.delete(id);
  }
  snapshot() { return [...this.#plugins.values()].map(p => jsonCopy({ id: p.id, apiVersion: p.apiVersion, requires: p.requires, skills: Object.keys(p.skills) })); }
}
