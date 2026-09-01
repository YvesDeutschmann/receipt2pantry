/**
 * App-side Costco B2C refresh_token grant (CapacitorHttp).
 * Used when the page has no MSAL RT or in-WebView grant hits CORS.
 * GraphQL still runs in-WebView — only the B2C hop uses native HTTP.
 */

import { CapacitorHttp } from '@capacitor/core';
import { decodeJwtPayload } from './jwtUtils';
import {
  resolveB2cTokenEndpoint,
  COSTCO_B2C_CLIENT_ID,
} from './costcoB2cConfig';

const B2C_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

/**
 * @param {object} opts
 * @param {string} opts.refreshToken
 * @param {string} opts.idToken - expired IdToken for policy/issuer (claims only)
 * @param {string|null|undefined} opts.refreshTokenClientId
 * @returns {Promise<{ idToken: string, refreshToken: string, accessToken?: string }>}
 */
export async function refreshCostcoTokensAppSide({ refreshToken, idToken, refreshTokenClientId }) {
  if (!refreshToken || !idToken) {
    throw new Error('refresh_token and idToken are required for app-side refresh');
  }

  const { endpoint } = resolveB2cTokenEndpoint(idToken);
  const clientId = refreshTokenClientId || COSTCO_B2C_CLIENT_ID;
  const body = [
    `grant_type=${encodeURIComponent('refresh_token')}`,
    `client_id=${encodeURIComponent(clientId)}`,
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    `scope=${encodeURIComponent(`openid offline_access ${clientId}`)}`,
  ].join('&');

  const response = await CapacitorHttp.post({
    url: endpoint,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': B2C_UA,
    },
    data: body,
  });

  const status = response.status ?? 0;
  let parsed = response.data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object') parsed = {};

  if (status !== 200 || !parsed.id_token) {
    const errCode = parsed.error || `http_${status}`;
    const err = new Error(`Token refresh failed: ${errCode}`);
    err.code = errCode;
    err.status = status;
    throw err;
  }

  const newPayload = decodeJwtPayload(parsed.id_token);
  if (!newPayload?.exp) {
    const err = new Error('Token refresh response missing valid id_token');
    err.code = 'invalid_token';
    throw err;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (newPayload.exp <= nowSec + 60) {
    const err = new Error('Token refresh response id_token already expired (clock skew)');
    err.code = 'refresh_clock_skew';
    throw err;
  }

  return {
    idToken: parsed.id_token,
    refreshToken: parsed.refresh_token || refreshToken,
    accessToken: parsed.access_token || undefined,
  };
}

/**
 * @param {Error|{ code?: string, message?: string, status?: number }} err
 * @returns {boolean}
 */
export function isTerminalRefreshError(err) {
  const code = String(err?.code || err?.message || '').toLowerCase();
  if (
    code.includes('invalid_grant') ||
    code.includes('interaction_required') ||
    code.includes('login_required') ||
    code.includes('refresh_clock_skew')
  ) {
    return true;
  }
  if (/^http_4/.test(code) || code.includes('http_404') || code.includes('http_400')) {
    return true;
  }
  const status = err?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return true;
  }
  return false;
}
