/** Stable machine-readable failures. Messages remain suitable for people. */
export const ACTION_FAILURE_CODES = Object.freeze([
  'START_UNSUPPORTED', 'NO_PATH', 'SEARCH_BUDGET', 'STALE_WORLD',
  'STEP_STALLED', 'OCCUPIED', 'SERVER_CORRECTION', 'SUPPORT_CHANGED', 'ACTION_FAILED',
  'STUCK','BLOCKED','UNLOADED','INVALID_SUPPORT','INSUFFICIENT_RESOURCES','UNSAFE_ROUTE','DYNAMIC_OBSTACLE','ACTION_TIMEOUT'
]);
const codes = new Set(ACTION_FAILURE_CODES);
const scalar = v => v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 512;

export function normalizeActionFailure(failure = {}) {
  if (!failure || typeof failure !== 'object') failure = {};
  const code = codes.has(failure.code) ? failure.code : 'ACTION_FAILED';
  const evidence = failure.evidence;
  if (!evidence || typeof evidence !== 'object' || !evidence.facts || typeof evidence.facts !== 'object' || Array.isArray(evidence.facts)) return { code };
  const entries = Object.entries(evidence.facts);
  if (entries.length > 128 || entries.some(([k, v]) => !k || k.length > 100 || ['__proto__','constructor','prototype'].includes(k) || !scalar(v))) return { code };
  return { code, evidence: { complete: evidence.complete === true, facts: Object.fromEntries(entries) } };
}

export class OMActionError extends Error {
  constructor(code, message, evidence) {
    super(message);
    this.name = 'OMActionError';
    Object.assign(this, normalizeActionFailure({ code, evidence }));
  }
}

/** A state ID is version-local; records must also be scoped to one world. */
export function blockEvidenceValue(block) {
  if (!block) return null;
  return JSON.stringify([block.stateId ?? block.name ?? block.id, block.boundingBox ?? null, block.shapes ?? null]);
}
