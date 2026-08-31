/**
 * Costco Azure AD B2C constants (client + backend share the same values).
 * Interpolate into extract script strings; do not duplicate elsewhere in JS.
 */

import { decodeJwtPayload } from './jwtUtils';

/** B2C directory tenant GUID (from MSAL realm / homeAccountId), not user object id. */
export const COSTCO_B2C_TENANT = 'e0714dd4-784d-46d6-a278-3e29553483eb';
export const COSTCO_B2C_POLICY_FALLBACK = 'b2c_1a_sso_wcs_signup_signin_209';
export const COSTCO_B2C_CLIENT_ID = 'a3a5186b-7c89-4b4c-93a8-dd604e930757';

const POLICY_RE = /^[a-z0-9_-]{1,128}$/i;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {object|null|undefined} payload - decoded JWT payload
 * @returns {string}
 */
export function b2cPolicyFromPayload(payload) {
  const raw = payload?.tfp || payload?.acr || COSTCO_B2C_POLICY_FALLBACK;
  const policy = String(raw).trim().toLowerCase();
  return POLICY_RE.test(policy) ? policy : COSTCO_B2C_POLICY_FALLBACK;
}

/**
 * @param {object|null|undefined} entry - MSAL cache entry
 * @returns {{ tenant: string|null, policy: string|null }}
 */
export function b2cAuthorityFromMsalEntry(entry) {
  if (!entry) return { tenant: null, policy: null };
  const hai = String(entry.homeAccountId || '');
  const dot = hai.lastIndexOf('.');
  const tid = entry.realm || (dot > 0 ? hai.slice(dot + 1) : '');
  const uid = dot > 0 ? hai.slice(0, dot) : hai;
  const m = /-(b2c_1a_[a-z0-9_]+)$/i.exec(uid);
  return {
    tenant: GUID_RE.test(tid) ? tid : null,
    policy: m ? m[1].toLowerCase() : null,
  };
}

/**
 * @param {string|null|undefined} idToken
 * @param {{ tenant?: string|null, policy?: string|null }|null|undefined} [msalAuthority]
 * @returns {{ endpoint: string, policy: string, tenant: string, authoritySource: string }}
 */
export function resolveB2cTokenEndpoint(idToken, msalAuthority) {
  let policy = COSTCO_B2C_POLICY_FALLBACK;
  let tenant = COSTCO_B2C_TENANT;
  let authoritySource = 'fallback';

  const payload = decodeJwtPayload(idToken);
  const issuer = String(payload?.iss || '');
  if (payload && issuer.includes('signin.costco.com')) {
    policy = b2cPolicyFromPayload(payload);
    const parts = issuer.replace(/\/$/, '').split('/');
    if (parts.length > 1 && parts[parts.length - 1] === 'v2.0') {
      tenant = parts[parts.length - 2] || tenant;
    } else if (parts.length > 0) {
      tenant = parts[parts.length - 1] || tenant;
    }
    authoritySource = 'iss';
  } else if (msalAuthority?.tenant) {
    tenant = msalAuthority.tenant;
    if (msalAuthority.policy) {
      policy = msalAuthority.policy;
    }
    authoritySource = 'msal';
  }

  const endpoint = `https://signin.costco.com/${tenant}/${policy}/oauth2/v2.0/token`;
  return { endpoint, policy, tenant, authoritySource };
}

/**
 * @param {string|null|undefined} idToken
 * @returns {string}
 */
export function buildB2cTokenEndpointFromIdToken(idToken) {
  return resolveB2cTokenEndpoint(idToken).endpoint;
}
