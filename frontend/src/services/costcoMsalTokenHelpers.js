/**
 * Test-facing exports for MSAL credential selection. Logic is defined once in
 * costcoMsalCredentialSource.js (embedded in the WebView inject script).
 */

import { MSAL_CREDENTIAL_JS } from './costcoMsalCredentialSource';

// eslint-disable-next-line no-new-func
const _api = new Function(
  `${MSAL_CREDENTIAL_JS}

  return { isJwtExpired, jwtExpiresAtSec, jwtClaim, jwtSecondsLeft, findRT, findRTWithKey, findIdToken, findAccessToken, findExpiredIdToken, findAnySigninIdToken, findSigninIdTokenForEndpointAny, findB2cAuthorityAny, b2cAuthorityFromEntry, credentialCensus };`
)();

export const isJwtExpired = _api.isJwtExpired;
export const jwtExpiresAtSec = _api.jwtExpiresAtSec;
export const jwtClaim = _api.jwtClaim;
export const jwtSecondsLeft = _api.jwtSecondsLeft;
export const findFreshIdToken = _api.findIdToken;
export const findFreshAccessToken = _api.findAccessToken;
export const findRT = _api.findRT;
export const findRTWithKey = _api.findRTWithKey;
export const findExpiredIdToken = _api.findExpiredIdToken;
export const findAnySigninIdToken = _api.findAnySigninIdToken;
export const findSigninIdTokenForEndpointAny = _api.findSigninIdTokenForEndpointAny;
export const findB2cAuthorityAny = _api.findB2cAuthorityAny;
export const b2cAuthorityFromEntry = _api.b2cAuthorityFromEntry;
export const credentialCensus = _api.credentialCensus;

/** Build a JWT with exp in seconds from now (for tests). */
export function makeTestJwt(expOffsetSec = 3600) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSec }));
  return `${header}.${payload}.sig`;
}
