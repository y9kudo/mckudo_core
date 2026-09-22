export class ConfigError extends Error {
  constructor(path, detail) { super(`${path}: ${detail}`); this.name = 'ConfigError'; this.path = path; }
}
export const object = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
export const id = x => typeof x === 'string' && /^[a-zA-Z0-9_:.\/-]{1,100}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
const fail = (path, text) => { throw new ConfigError(path, text); };
export function jsonCopy(value, path = '$', maxBytes = 262144) {
  const seen = new Set();
  function check(v, p, depth) {
    if (depth > 20) fail(p, 'слишком большая вложенность JSON');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
    if (!Array.isArray(v) && !object(v)) fail(p, 'нужно обычное JSON-значение, без функций и объектов классов');
    if (seen.has(v)) fail(p, 'циклический JSON');
    seen.add(v);
    for (const [k, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) fail(p + '.' + k, 'зарезервированное имя');
      check(child, p + '.' + k, depth + 1);
    }
    seen.delete(v);
  }
  check(value, path, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) fail(path, 'JSON превышает допустимый размер');
  return JSON.parse(text);
}
function keys(value, allowed, path) {
  if (!object(value)) fail(path, 'нужен объект {...}');
  for (const k of Object.keys(value)) if (!allowed.includes(k)) fail(`${path}.${k}`, 'неизвестное поле; проверь написание');
}
function integer(n, min, max, path) { if (!Number.isInteger(n) || n < min || n > max) fail(path, `нужно целое число ${min}–${max}`); }
export function validateCondition(c, path, depth = 0) {
  if (depth > 8) fail(path, 'условие вложено глубже 8 уровней');
  if (!object(c)) fail(path, 'нужно условие {...}');
  if ('all' in c || 'any' in c) {
    const op = 'all' in c ? 'all' : 'any'; keys(c, [op], path);
    if (!Array.isArray(c[op]) || c[op].length < 1 || c[op].length > 16) fail(path + '.' + op, 'нужно 1–16 условий');
    c[op].forEach((v, i) => validateCondition(v, `${path}.${op}[${i}]`, depth + 1)); return;
  }
  if ('not' in c) { keys(c, ['not'], path); validateCondition(c.not, path + '.not', depth + 1); return; }
  const operators = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists'];
  keys(c, ['fact', ...operators], path);
  if (typeof c.fact !== 'string' || !/^\/(?:[^~]|~[01])*$/.test(c.fact) || c.fact.length > 200) fail(path + '.fact', 'нужен путь JSON Pointer, например /self/food');
  const op = operators.filter(k => Object.hasOwn(c, k));
  if (op.length !== 1) fail(path, 'укажи ровно одно сравнение: eq, ne, lt, lte, gt, gte или exists');
  if (op[0] === 'exists') { if (typeof c.exists !== 'boolean') fail(path + '.exists', 'нужно true или false'); }
  else if (['lt', 'lte', 'gt', 'gte'].includes(op[0])) { if (typeof c[op[0]] !== 'number' || !Number.isFinite(c[op[0]])) fail(path + '.' + op[0], 'нужно число'); }
  else if (c[op[0]] !== null && !['string', 'boolean', 'number'].includes(typeof c[op[0]])) fail(path, 'eq/ne сравнивают строку, число, boolean или null');
}
export function validateConfig(input) {
  const c = jsonCopy(input);
  keys(c, ['$schema', 'schemaVersion', 'name', 'worldId', 'tickIntervalMs', 'actionTimeoutMs', 'failureBackoffMs', 'maxHistory', 'rules', 'workflows'], '$');
  if (c.$schema !== undefined && typeof c.$schema !== 'string') fail('$.$schema', 'нужна строка с адресом схемы');
  if (![1, 2].includes(c.schemaVersion)) fail('$.schemaVersion', 'поддерживаются версии 1 и 2');
  if (c.schemaVersion === 1 && c.workflows !== undefined && (!Array.isArray(c.workflows) || c.workflows.length)) fail('$.workflows', 'для многошаговых задач укажи schemaVersion: 2');
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 64) fail('$.name', 'нужно имя, 1–64 символа');
  if (typeof c.worldId !== 'string' || !c.worldId.trim() || c.worldId.length > 128) fail('$.worldId', 'назови мир, например local-test');
  c.tickIntervalMs ??= 1000; c.actionTimeoutMs ??= 15000; c.failureBackoffMs ??= 5000; c.maxHistory ??= 50;
  integer(c.tickIntervalMs, 50, 60000, '$.tickIntervalMs'); integer(c.actionTimeoutMs, 100, 300000, '$.actionTimeoutMs');
  integer(c.failureBackoffMs, 100, 300000, '$.failureBackoffMs'); integer(c.maxHistory, 1, 200, '$.maxHistory');
  if (c.schemaVersion === 2) c.rules ??= [];
  if (!Array.isArray(c.rules) || c.rules.length < (c.schemaVersion === 1 ? 1 : 0) || c.rules.length > 64) fail('$.rules', 'нужен список, максимум 64 правила');
  const names = new Set();
  c.rules.forEach((r, i) => {
    const p = `$.rules[${i}]`; keys(r, ['id', 'priority', 'description', 'when', 'action'], p);
    if (!id(r.id) || names.has(r.id)) fail(p + '.id', 'нужен уникальный идентификатор правила'); names.add(r.id);
    r.priority ??= 0; integer(r.priority, -1000, 1000, p + '.priority');
    if (r.description !== undefined && (typeof r.description !== 'string' || r.description.length > 300)) fail(p + '.description', 'максимум 300 символов');
    if (r.when !== undefined) validateCondition(r.when, p + '.when');
    keys(r.action, ['skill', 'args'], p + '.action');
    if (!id(r.action.skill)) fail(p + '.action.skill', 'нужно имя навыка');
    r.action.args ??= {}; if (!object(r.action.args)) fail(p + '.action.args', 'нужен объект аргументов');
  });
  c.workflows ??= [];
  if (!Array.isArray(c.workflows) || c.workflows.length > 16) fail('$.workflows', 'нужен список, максимум 16 задач');
  if (!c.rules.length && !c.workflows.length) fail('$', 'добавь хотя бы одно правило или задачу');
  const workflowNames = new Set(); let totalSteps = 0;
  c.workflows.forEach((w, wi) => {
    const p = `$.workflows[${wi}]`; keys(w, ['id', 'priority', 'description', 'when', 'steps'], p);
    if (!id(w.id) || workflowNames.has(w.id)) fail(p + '.id', 'нужен уникальный идентификатор задачи'); workflowNames.add(w.id);
    w.priority ??= 0; integer(w.priority, -1000, 1000, p + '.priority');
    if (w.description !== undefined && (typeof w.description !== 'string' || w.description.length > 300)) fail(p + '.description', 'максимум 300 символов');
    if (w.when !== undefined) validateCondition(w.when, p + '.when');
    if (!Array.isArray(w.steps) || w.steps.length < 1 || w.steps.length > 64) fail(p + '.steps', 'нужно 1–64 шага');
    totalSteps += w.steps.length;
    const stepNames = new Set();
    w.steps.forEach((s, si) => {
      const sp = `${p}.steps[${si}]`; keys(s, ['id', 'dependsOn', 'action', 'until', 'maxAttempts', 'retryDelayMs'], sp);
      if (!id(s.id) || stepNames.has(s.id)) fail(sp + '.id', 'нужен уникальный идентификатор шага'); stepNames.add(s.id);
      s.dependsOn ??= si ? [w.steps[si - 1].id] : [];
      if (!Array.isArray(s.dependsOn) || !s.dependsOn.every(id) || new Set(s.dependsOn).size !== s.dependsOn.length) fail(sp + '.dependsOn', 'нужен список уникальных ID шагов');
      keys(s.action, ['skill', 'args'], sp + '.action');
      if (!id(s.action.skill)) fail(sp + '.action.skill', 'нужно имя навыка');
      s.action.args ??= {}; if (!object(s.action.args)) fail(sp + '.action.args', 'нужен объект');
      if (s.until !== undefined) validateCondition(s.until, sp + '.until');
      s.maxAttempts ??= 32; s.retryDelayMs ??= c.failureBackoffMs;
      integer(s.maxAttempts, 1, 1000, sp + '.maxAttempts'); integer(s.retryDelayMs, 100, 300000, sp + '.retryDelayMs');
    });
    const graph = new Map(w.steps.map(s => [s.id, s.dependsOn])), visiting = new Set(), done = new Set();
    const visit = name => {
      if (!graph.has(name)) fail(p + '.steps', `зависимость ${name} не существует`);
      if (visiting.has(name)) fail(p + '.steps', `цикл зависимостей около ${name}`);
      if (done.has(name)) return;
      visiting.add(name); for (const dep of graph.get(name)) visit(dep); visiting.delete(name); done.add(name);
    };
    for (const s of w.steps) visit(s.id);
  });
  if (totalSteps > 256) fail('$.workflows', 'максимум 256 шагов на агента');
  return c;
}
