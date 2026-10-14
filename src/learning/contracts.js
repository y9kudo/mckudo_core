// OvermindMC learning contracts — y9kudo, MIT.
export function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name}: ${min}..${max}`);
  return value;
}
export function finite(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name}: ${min}..${max}`);
  return value;
}
export function randomSource(seed = 1) {
  integer(seed, 0, 0xffffffff, 'seed'); let state = seed >>> 0;
  return { next() { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; },
    get state() { return state; }, set state(s) { state = integer(s, 0, 0xffffffff, 'random state') >>> 0; } };
}
export function vector(value, size, name = 'observation') {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== size || !Array.from(value).every(Number.isFinite)) throw new TypeError(`${name}: ${size} finite numbers`);
  const converted=Float32Array.from(value);if(!converted.every(Number.isFinite))throw new TypeError(`${name}: Float32 overflow`);return converted;
}
export function actionMask(value, actions) {
  if (value === undefined) return Array(actions).fill(true);
  if (!Array.isArray(value) || value.length !== actions || value.some(v => typeof v !== 'boolean') || !value.some(Boolean)) throw new TypeError('actionMask: nonempty boolean mask');
  return [...value];
}
export function argmax(values, mask) {
  let best = -1;
  for (let i = 0; i < values.length; i++) if ((!mask || mask[i]) && (best < 0 || values[i] > values[best])) best = i;
  if (best < 0) throw new Error('No available action'); return best;
}
