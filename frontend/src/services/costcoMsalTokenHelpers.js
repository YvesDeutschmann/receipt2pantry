/**
 * Test-facing exports for MSAL credential selection. Logic is defined once in
 * costcoMsalCredentialSource.js (embedded in the WebView inject script).
 */

import { MSAL_CREDENTIAL_JS } from './costcoMsalCredentialSource';

// eslint-disable-next-line no-new-func
const _api = new Function(
  `${MSAL_CREDENTIAL_JS}; return { isJwtExpired, jwtExpiresAtSec, findRT, findIdToken, findAccessToken };`
)();

export const isJwtExpired = _api.isJwtExpired;
export const jwtExpiresAtSec = _api.jwtExpiresAtSec;
export const findFreshIdToken = _api.findIdToken;
export const findFreshAccessToken = _api.findAccessToken;

/** Build a JWT with exp in seconds from now (for tests). */
export function makeTestJwt(expOffsetSec = 3600) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSec }));
  return `${header}.${payload}.sig`;
}
