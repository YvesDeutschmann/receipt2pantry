/**
 * Debug flags and safe logging helpers for silent sync (localStorage).
 */

const FLAG_TIER_TRACE = 'SYNC_TIER_TRACE';
const FLAG_TELEMETRY_DEV_PANEL = 'SYNC_TELEMETRY_DEV_PANEL';
const FLAG_AUTO_ENABLED = 'SYNC_AUTO_ENABLED';
const FLAG_MIN_RESYNC_MS_OVERRIDE = 'SYNC_MIN_RESYNC_MS_OVERRIDE';

function flagOn(key) {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key) === '1';
}

/**
 * Read all known sync flags from localStorage. Fresh read on every call.
 * @returns {{
 *   tierTrace: boolean,
 *   telemetryDevPanel: boolean,
 *   autoEnabled: boolean,
 *   minResyncMsOverride: number | null,
 * }}
 */
export function readFlags() {
  let minResyncMsOverride = null;
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(FLAG_MIN_RESYNC_MS_OVERRIDE);
    if (raw != null && raw !== '') {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) minResyncMsOverride = n;
    }
  }

  return {
    tierTrace: flagOn(FLAG_TIER_TRACE),
    telemetryDevPanel: flagOn(FLAG_TELEMETRY_DEV_PANEL),
    autoEnabled: flagOn(FLAG_AUTO_ENABLED),
    minResyncMsOverride,
  };
}

/**
 * Redact a value for safe logging.
 * Returns `<length=N, head=ABCDEF>` for strings longer than 6 chars;
 * returns the literal `'<empty>'` for empty/null/undefined;
 * returns the value as-is for numbers/booleans.
 * @param {unknown} value
 */
export function redact(value) {
  if (value === null || value === undefined) return '<empty>';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return value;
  if (t !== 'string') return '<empty>';
  if (value === '') return '<empty>';
  const n = value.length;
  if (n > 6) return `<length=${n}, head=${value.slice(0, 6)}>`;
  return `<length=${n}>`;
}

/**
 * Emit a structured trace line when SYNC_TIER_TRACE=1.
 * Must be a no-op (early return) when the flag is off, before evaluating data.
 * @param {string} tag - e.g. "t2.safeway.cookieRead"
 * @param {object} [data] - Plain object; values should be passed through redact() by the caller when sensitive.
 */
export function trace(tag, data) {
  if (typeof localStorage === 'undefined' || localStorage.getItem(FLAG_TIER_TRACE) !== '1') return;
  console.log('[SyncTrace][' + tag + ']', data);
}
