/**
 * JWT helpers for client-side expiry checks (no signature verification).
 */

function base64UrlDecode(str) {
  if (str == null || typeof str !== 'string') return {};
  let payload = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = payload.length % 4;
  if (pad) payload += '='.repeat(4 - pad);
  try {
    return JSON.parse(atob(payload));
  } catch {
    return {};
  }
}

/**
 * Decode a JWT payload without signature verification.
 * @param {string|null|undefined} token
 * @returns {object} Payload object, or {} if decoding fails.
 */
export function decodeJwtPayload(token) {
  try {
    if (!token || typeof token !== 'string') return {};
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    return base64UrlDecode(parts[1]);
  } catch {
    return {};
  }
}

/**
 * Check if the token is expired or will expire within bufferSeconds.
 * @param {string|null|undefined} token
 * @param {number} [bufferSeconds=60]
 * @returns {boolean} true if expired, missing exp, malformed, or null.
 */
export function isTokenExpired(token, bufferSeconds = 60) {
  const payload = decodeJwtPayload(token);
  const exp = payload.exp;
  if (!exp) return true;
  const expiryTime = exp * 1000;
  return Date.now() >= expiryTime - bufferSeconds * 1000;
}
