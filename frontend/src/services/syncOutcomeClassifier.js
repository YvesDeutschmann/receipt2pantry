const EXPIRED_REASONS = new Set([
  'token_expired',
  'invalid_grant',
  'needs_reconnect',
  'refresh_invalid_grant',
  'refresh_login_required',
  'refresh_interaction_required',
  'missing_session_cookie',
  'login_required',
  'interaction_required',
]);

const TRANSIENT_TOKENS = new Set([
  'network',
  'timeout',
  'offline',
  'fetch',
  'failed',
  'connection',
  'refused',
  'econnreset',
  'enotfound',
]);

const EXPIRED_PHRASE_RE =
  /session.?expired|token.?expired|token.?invalid|credentials.?expired|unauthorized|forbidden/i;

/**
 * @param {string} text
 * @returns {string[]}
 */
function wholeTokens(text) {
  return String(text)
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasExpiredStatusToken(text) {
  return wholeTokens(text).some((t) => t === '401' || t === '403');
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasTransientToken(text) {
  const tokens = wholeTokens(text);
  if (tokens.includes('fetch') && tokens.includes('failed')) return true;
  return tokens.some((t) => TRANSIENT_TOKENS.has(t));
}

/**
 * @param {{ reason?: string, status?: number, message?: string }} input
 * @returns {'expired' | 'transient' | 'unknown'}
 */
export function classifySyncFailure({ reason, status, message } = {}) {
  if (status === 401 || status === 403) return 'expired';
  if (reason && EXPIRED_REASONS.has(reason)) return 'expired';

  for (const text of [reason, message]) {
    if (!text) continue;
    const str = String(text);
    if (EXPIRED_PHRASE_RE.test(str) || hasExpiredStatusToken(str)) {
      return 'expired';
    }
    if (hasTransientToken(str)) {
      return 'transient';
    }
  }

  return 'unknown';
}

/** @deprecated wrapper: classifySyncFailure({ message }) */
export function classifyError(message) {
  return classifySyncFailure({ message });
}
