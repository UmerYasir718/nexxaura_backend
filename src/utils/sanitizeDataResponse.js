/** Keys that must never appear in /api/data JSON (integration dumps). */
const FORBIDDEN = new Set(['raw_payload', 'raw_snapshot']);

/**
 * Recursively drop forbidden keys from objects (plain objects only; leaves Dates, etc. unchanged).
 * @param {unknown} value
 * @returns {unknown}
 */
function stripIntegrationRaw(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripIntegrationRaw);
  }
  if (typeof value === 'object' && value !== null && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) {
        continue;
      }
      out[k] = stripIntegrationRaw(v);
    }
    return out;
  }
  return value;
}

module.exports = { stripIntegrationRaw, FORBIDDEN };
