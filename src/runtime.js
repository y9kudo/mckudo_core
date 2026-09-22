import { id, jsonCopy } from './config.js';
export class MckudoRuntime {
  #agents = new Map(); #resources = new Set(); #pending = null; #paused = false; #concurrency;
  constructor({ concurrency = 2 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('concurrency: целое число 1–32.');
    this.#concurrency = concurrency;
  }
  add(name, core, { resourceKey = name } = {}) {
    if (this.#pending) throw new Error('Состав runtime нельзя менять во время шага.');
    if (!id(name) || typeof resourceKey !== 'string' || !resourceKey || resourceKey.length > 200 || !core?.tick || !core?.snapshot || !core?.pause || !core?.resume) throw new Error('Нужны ID агента, core и resourceKey.');
    if (this.#agents.has(name) || this.#resources.has(resourceKey) || [...this.#agents.values()].some(v => v.core === core)) throw new Error('Агент, экземпляр ядра или игровой ресурс уже занят.');
    if (core.snapshot().running) throw new Error('Останови отдельный цикл core.start() перед добавлением в runtime.');
    this.#agents.set(name, { core, resourceKey }); this.#resources.add(resourceKey); return this;
  }
  remove(name) {
    if (this.#pending) throw new Error('Состав runtime нельзя менять во время шага.');
    const agent = this.#agents.get(name); if (!agent) throw new Error(`Нет агента ${name}.`);
    this.#agents.delete(name); this.#resources.delete(agent.resourceKey); return agent.core;
  }
  snapshot() { return jsonCopy({ paused: this.#paused, concurrency: this.#concurrency,
    agents: Object.fromEntries([...this.#agents].map(([name, a]) => [name, a.core.snapshot()])) }, '$', 33554432); }
  tick() {
    if (this.#pending) return this.#pending;
    if (this.#paused) return Promise.resolve(this.snapshot());
    this.#pending = Promise.resolve().then(async () => {
      const agents = [...this.#agents.values()]; let cursor = 0;
      const worker = async () => {
        while (!this.#paused && cursor < agents.length) {
          const { core } = agents[cursor++];
          if (core.snapshot().running) throw new Error('Не запускай core.start() для агента, которым управляет runtime.');
          await core.tick();
        }
      };
      // Wait for all workers, even if one misbehaving third-party core throws.
      const results = await Promise.allSettled(Array.from({ length: Math.min(this.#concurrency, agents.length) }, worker));
      const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
      return this.snapshot();
    }).finally(() => { this.#pending = null; });
    return this.#pending;
  }
  async pause() {
    this.#paused = true;
    const results = await Promise.allSettled([...this.#agents.values()].map(a => a.core.pause()));
    await this.#pending;
    const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    return this.snapshot();
  }
  resume() { this.#paused = false; for (const { core } of this.#agents.values()) core.resume(); return this; }
  async stop() { await this.pause(); }
}
