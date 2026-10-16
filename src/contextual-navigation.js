const INPUTS = 24, HIDDEN = 16, OUTPUTS = 3, MAX_REPLAY = 256;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sigmoid = x => 1 / (1 + Math.exp(-clamp(x, -20, 20)));
const finite = (a, length, max = 1000) => Array.isArray(a) && a.length === length && a.every(n => Number.isFinite(n) && Math.abs(n) <= max);

/** Context-conditioned failure/time/damage estimates, learned only from observed outcomes. */
export function createContextualNavigation({ learningRate = .025, memory } = {}) {
  let seed = 81371, samples = 0, updates = 0, loss = 0, cursor = 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let w = Array.from({ length: HIDDEN }, () => Array.from({ length: INPUTS }, () => (random() - .5) * .3)), b = Array(HIDDEN).fill(0);
  let v = Array.from({ length: OUTPUTS }, () => Array.from({ length: HIDDEN }, () => (random() - .5) * .3)), bias = [-1, -.5, -2];
  const replay = [], predictions = new Map();
  const counters = [0, 0, 0];
  const forward = x => {
    const h = w.map((row, i) => Math.tanh(row.reduce((s, a, j) => s + a * x[j], b[i])));
    return { h, out: v.map((row, i) => sigmoid(row.reduce((s, a, j) => s + a * h[j], bias[i]))) };
  };
  const train = ({ x, y, mask }) => {
    const { h, out } = forward(x), hidden = Array(HIDDEN).fill(0); let error = 0;
    for (let o = 0; o < OUTPUTS; o++) if (mask[o]) {
      const d = clamp(out[o] - y[o], -1, 1);
      for (let i = 0; i < HIDDEN; i++) { hidden[i] += d * v[o][i]; v[o][i] -= learningRate * d * h[i]; }
      bias[o] -= learningRate * d;
      error += -y[o] * Math.log(Math.max(1e-9, out[o])) - (1 - y[o]) * Math.log(Math.max(1e-9, 1 - out[o]));
    }
    for (let i = 0; i < HIDDEN; i++) { const d = clamp(hidden[i], -1, 1) * (1 - h[i] * h[i]); b[i] -= learningRate * d; for (let j = 0; j < INPUTS; j++) w[i][j] -= learningRate * d * x[j]; }
    updates++; loss = loss * .95 + error * .05;
  };
  if (memory) {
    const m = structuredClone(memory);
    if (m.architecture !== '24-16-3' || !Number.isSafeInteger(m.samples) || m.samples < 0 || !Number.isSafeInteger(m.updates) || m.updates < 0 || !Array.isArray(m.weights?.w) || m.weights.w.length !== HIDDEN || m.weights.w.some(row => !finite(row, INPUTS)) || !finite(m.weights.b, HIDDEN) || !Array.isArray(m.weights.v) || m.weights.v.length !== OUTPUTS || m.weights.v.some(row => !finite(row, HIDDEN)) || !finite(m.weights.bias, OUTPUTS) || !Array.isArray(m.replay) || m.replay.length > MAX_REPLAY || m.replay.some(s => !finite(s.x, INPUTS, 1) || !finite(s.y, OUTPUTS, 1) || s.y.some(n => n < 0) || !Array.isArray(s.mask) || s.mask.length !== OUTPUTS || s.mask.some(n => typeof n !== 'boolean')) || !finite(m.counters, OUTPUTS, Number.MAX_SAFE_INTEGER) || m.counters.some(n => !Number.isInteger(n) || n < 0 || n > m.samples)) throw new Error('Contextual navigation memory is invalid.');
    ({ w, b, v, bias } = m.weights); samples = m.samples; updates = m.updates; replay.push(...m.replay); counters.splice(0, OUTPUTS, ...m.counters);
  }
  const encode = (legacy, c) => {
    if (!finite(legacy, 12, 1) || !c || typeof c.loaded !== 'boolean' || typeof c.signature !== 'string' || !/^[a-f0-9]{1,16}$/.test(c.signature) || ['slipperiness', 'speed', 'headroom', 'fallHeight', 'hazards', 'hostiles', 'historyFailureRate', 'historyConfidence'].some(k => !Number.isFinite(c[k])) || ['water', 'lava', 'slow'].some(k => typeof c[k] !== 'boolean')) throw new Error('Navigation geometry context is invalid.');
    return [...legacy, Number(c.loaded), clamp(c.slipperiness), clamp(c.speed / 2), clamp(c.headroom / 3), Number(c.water), Number(c.lava), Number(c.slow), clamp(c.fallHeight / 16), clamp(c.hazards / 8), clamp(c.hostiles / 8), clamp(c.historyFailureRate), clamp(c.historyConfidence)];
  };
  return {
    record(legacy, event) {
      const x = encode(legacy, event.context); if (!event.context.loaded) return false;
      const timed = Number.isFinite(event.durationMs) && event.durationMs > 0 && event.durationMs <= 120000 && !event.timingEstimated;
      const damaged = Number.isFinite(event.health) && Number.isFinite(event.healthAfter) && !event.damageEstimated;
      const sample = { x, y: [Number(event.outcome === 'failure'), timed ? clamp(Math.log1p(event.durationMs) / Math.log1p(120000)) : 0, damaged ? clamp((event.health - event.healthAfter) / 20) : 0], mask: [true, timed, damaged] };
      sample.mask.forEach((active, i) => { if (active) counters[i]++; });
      replay.push(sample); if (replay.length > MAX_REPLAY) replay.shift(); samples++;
      train(sample); for (let i = 0; i < Math.min(8, replay.length); i++) train(replay[cursor++ % replay.length]); predictions.clear(); return true;
    },
    assess(legacy, context) {
      const x = encode(legacy, context), id = x.join(',');
      if (!predictions.has(id)) {
        const out = forward(x).out;
        let nearest = 1;
        // A bounded recent subset gates out-of-distribution estimates; this is not a calibrated confidence interval.
        for (const s of replay.slice(-64)) nearest = Math.min(nearest, Math.sqrt(s.x.reduce((n, v, i) => n + (v - x[i]) ** 2, 0) / INPUTS));
        predictions.set(id, { out, nearest }); if (predictions.size > 256) predictions.delete(predictions.keys().next().value);
      }
      const { out, nearest } = predictions.get(id), uncertainty = Math.max(16 / (16 + samples), clamp(nearest * 3));
      const trained = samples >= 16 && context.loaded && uncertainty < .75;
      const expectedTimeMs = counters[1] >= 16 ? Math.expm1(out[1] * Math.log1p(120000)) : null;
      const expectedDamage = counters[2] >= 16 ? out[2] * 20 : null;
      return { failureProbability: out[0], expectedTimeMs, expectedDamage, uncertainty, trained, samples,
        cost: trained ? Math.min(30, (out[0] * 8 + (expectedDamage ?? 0) * 1.5 + Math.min(4, (expectedTimeMs ?? 0) / 2000)) * (1 - uncertainty)) : 0 };
    },
    snapshot: () => ({ architecture: '24-16-3', samples, updates, loss, timedSamples: counters[1], damageSamples: counters[2], replaySize: replay.length, replayCapacity: MAX_REPLAY }),
    export: () => structuredClone({ architecture: '24-16-3', samples, updates, weights: { w, b, v, bias }, counters, replay })
  };
}
