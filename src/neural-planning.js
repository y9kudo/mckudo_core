import { jsonCopy } from './config.js';
import {episodeHash,episodeNamespaceHash} from './learning/episode-provenance.js';

const INPUTS = 24, HIDDEN = 24;
const skills = ['craft', 'dig', 'navigate', 'collect', 'smelt', 'ensureStation', 'gather', 'pillar'];
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const point = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const hash = (text, salt) => { let h = salt; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295 * 2 - 1; };

function encode(observation, action) {
  if (!observation || typeof action?.skill !== 'string' || !action.args || typeof action.args !== 'object') throw new Error("Training needs observation and action.");
  const self = observation.self || {}, args = action.args, from = self.position, to = point(args) ? args : args.origin;
  if (['health', 'food', 'freeInventorySlots'].some(k => self[k] != null && !Number.isFinite(self[k]))) throw new Error("Uncorrect observational signs.");
  const inventory = observation.inventory || {}, item = String(args.item || args.block || args.station || '');
  const dx = point(from) && point(to) ? to.x - from.x : 0, dy = point(from) && point(to) ? to.y - from.y : 0, dz = point(from) && point(to) ? to.z - from.z : 0;
  const recipe = String(args.recipeId || '');
  const encoded = [...skills.map(s => Number(s === action.skill)),
    clamp((self.health ?? 20) / 20), clamp((self.food ?? 20) / 20), clamp((self.freeInventorySlots ?? 36) / 36),
    clamp(Math.hypot(dx, dy, dz) / 64), clamp(dy / 16, -1, 1), clamp((args.count ?? 1) / 64),
    Number(observation.dimension === 'minecraft:the_nether'), Number(observation.dimension === 'minecraft:the_end'),
    Number(Object.keys(inventory).some(id => id.endsWith('_pickaxe') && inventory[id] > 0)),
    Number(Object.keys(inventory).some(id => id.endsWith('_axe') && inventory[id] > 0)),
    clamp((inventory[item] || inventory['minecraft:' + item] || 0) / 64),
    hash(item, 2166136261), hash(item, 1237), hash(recipe, 2166136261), hash(recipe, 1237),
    clamp((observation.entities || []).filter(e => e.hostile).length / 8)];
  if (encoded.some(n => !Number.isFinite(n))) throw new Error("Invalid action features.");
  return encoded;
}

/** Local learned ranking of legal plans. Recipes and physics remain hard constraints.
 * A 24→24→1 network predicts failure from actual action outcomes; no pretrained claims.
 */
export function createNeuralPlanner({ worldId, memory, learningRate = .025, clock = Date.now, mode = 'train' } = {}) {
  if (typeof worldId !== 'string' || !worldId.trim() || worldId.length > 128 || !Number.isFinite(learningRate) || learningRate <= 0 || learningRate > .1) throw new Error("The planner needs worldId and learningRate (0,.1].");
  if(!['train','evaluate'].includes(mode))throw new Error('Neural planner mode must be train or evaluate.');
  let seed = 317, samples = 0, updates = 0, cursor = 0, loss = 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  let w = Array.from({ length: HIDDEN }, () => Array.from({ length: INPUTS }, () => (random() - .5) * .3));
  let b = Array(HIDDEN).fill(0), v = Array.from({ length: HIDDEN }, () => (random() - .5) * .3), bias = -1;
  const replay = [], journal = [], episodeHashes=new Set(),namespaceHashes=new Set(),predictions=new Map();let provenanceComplete=true,namespaceCoverageComplete=true;
  const forward = x => { const h = w.map((row, i) => Math.tanh(row.reduce((n, a, j) => n + a * x[j], b[i]))); return { h, p: 1 / (1 + Math.exp(-clamp(h.reduce((n, a, i) => n + a * v[i], bias), -20, 20))) }; };
  const train = ({ x, y }) => {
    predictions.clear();
    const { h, p } = forward(x), dz = p - y, old = [...v];
    for (let i = 0; i < HIDDEN; i++) { v[i] -= learningRate * dz * h[i]; const d = dz * old[i] * (1 - h[i] ** 2); b[i] -= learningRate * d; for (let j = 0; j < INPUTS; j++) w[i][j] -= learningRate * d * x[j]; }
    bias -= learningRate * dz; updates++; loss = .95 * loss + .05 * (-y * Math.log(Math.max(1e-9, p)) - (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
  };
  if (memory) {
    const m = jsonCopy(memory, 'cognitionMemory', 2 * 1024 * 1024), finite = a => Array.isArray(a) && a.every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
    if (![1,2].includes(m.schemaVersion) || m.worldId !== worldId || m.architecture !== '24-24-1' || ![m.samples, m.updates].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("The memory of a planner in another world or a wrong format.");
    if (!Array.isArray(m.weights?.w) || m.weights.w.length !== HIDDEN || m.weights.w.some(a => !finite(a) || a.length !== INPUTS) || !finite(m.weights.b) || m.weights.b.length !== HIDDEN || !finite(m.weights.v) || m.weights.v.length !== HIDDEN || !Number.isFinite(m.weights.bias) || Math.abs(m.weights.bias) > 1000) throw new Error("The weight of the planner is damaged.");
    if (!Array.isArray(m.replay) || m.replay.length > 256 || m.replay.some(s => !finite(s.x) || s.x.length !== INPUTS || s.x.some(n => Math.abs(n) > 1) || ![0, 1].includes(s.y))) throw new Error("Damaged by the planning experience.");
    ({ w, b, v, bias } = m.weights); samples = m.samples; updates = m.updates; replay.push(...m.replay);
    if(m.schemaVersion===2){
      const hashes=a=>Array.isArray(a)&&new Set(a).size===a.length&&a.every(h=>typeof h==='string'&&/^[a-f0-9]{32}$/.test(h));
      if(typeof m.provenance?.complete!=='boolean'||!hashes(m.provenance.episodeHashes)||m.provenance.episodeHashes.length>2048||m.provenance.namespaceHashes!==undefined&&(!hashes(m.provenance.namespaceHashes)||m.provenance.namespaceHashes.length>64)||m.provenance.namespaceCoverageComplete!==undefined&&typeof m.provenance.namespaceCoverageComplete!=='boolean')throw new Error('Planner training provenance is invalid.');
      for(const h of m.provenance.episodeHashes)episodeHashes.add(h);for(const h of m.provenance.namespaceHashes||[])namespaceHashes.add(h);
      namespaceCoverageComplete=m.provenance.namespaceCoverageComplete===true;provenanceComplete=m.provenance.complete&&(episodeHashes.size===samples||namespaceCoverageComplete&&namespaceHashes.size>0);
    }else{provenanceComplete=samples===0;namespaceCoverageComplete=samples===0;}
  }
  return {
    worldId,
    get mode(){return mode;},
    setMode(next){if(!['train','evaluate'].includes(next))throw new Error('Neural planner mode must be train or evaluate.');mode=next;},
    assess(observation, action) {
      const x=encode(observation,action),key=x.join(',');
      if(!predictions.has(key)){let nearest=1;for(const sample of replay.slice(-64))nearest=Math.min(nearest,Math.sqrt(sample.x.reduce((s,v,i)=>s+(v-x[i])**2,0)/INPUTS));predictions.set(key,{probability:forward(x).p,uncertainty:Math.max(16/(16+samples),clamp(nearest*3))});if(predictions.size>256)predictions.delete(predictions.keys().next().value);}
      const {probability,uncertainty}=predictions.get(key),trained=samples>=8&&uncertainty<.75;
      return {failureProbability:probability,trained,uncertainty,cost:trained?probability*16:0};
    },
    record({ before, after, action, outcome, detail = '', verified, failureCode, episodeId }) {
      if (!['success', 'failure', 'cancelled', 'progress'].includes(outcome)) throw new Error("Unknown outcome.");
      if(mode==='evaluate'||outcome==='cancelled'||outcome==='progress'&&verified!==true||verified===false&&outcome==='success'||!skills.includes(action?.skill)||['STALE_WORLD','SERVER_CORRECTION','OCCUPIED','SUPPORT_CHANGED','UNLOADED','DYNAMIC_OBSTACLE'].includes(failureCode)) return false;
      if(episodeId!==undefined&&(typeof episodeId!=='string'||!episodeId||episodeId.length>160))throw new Error('Planner episodeId must be a bounded string.');
      const hash=episodeId?episodeHash(episodeId):null;if(hash&&episodeHashes.has(hash))return false;
      const x = encode(before, action);
      if (after?.self?.health != null && !Number.isFinite(after.self.health)) throw new Error("Uncorrect observation.");
      const y = Number(outcome === 'failure' || after?.self?.health != null && after.self.health < (before.self?.health ?? 20));
      if(hash){episodeHashes.add(hash);namespaceHashes.add(episodeNamespaceHash(episodeId));if(namespaceHashes.size>64){namespaceHashes.delete(namespaceHashes.values().next().value);namespaceCoverageComplete=false;provenanceComplete=false;}if(episodeHashes.size>2048){episodeHashes.delete(episodeHashes.values().next().value);if(!namespaceCoverageComplete)provenanceComplete=false;}}else provenanceComplete=false;
      const sample = { x, y }; replay.push(sample); if (replay.length > 256) replay.shift(); samples++;
      train(sample); for (let i = 0; i < Math.min(12, replay.length); i++) train(replay[cursor++ % replay.length]);
      journal.push({ at: clock(), skill: action.skill, item: action.args.item || action.args.block || '', outcome, damage: outcome !== 'failure' && y === 1, detail: String(detail).slice(0, 200) }); if (journal.length > 32) journal.shift(); return true;
    },
    snapshot: () => ({ kind: 'local-neural-planner', architecture: '24-24-1', mode,samples, updates, loss,provenanceComplete,trackedEpisodes:episodeHashes.size,trainingNamespaces:namespaceHashes.size,journal: structuredClone(journal) }),
    export: () => jsonCopy({ schemaVersion: 2, architecture: '24-24-1', worldId, samples, updates, weights: { w, b, v, bias }, replay,provenance:{complete:provenanceComplete,episodeHashes:[...episodeHashes],namespaceHashes:[...namespaceHashes],namespaceCoverageComplete} }, 'cognitionMemory', 2 * 1024 * 1024)
  };
}
