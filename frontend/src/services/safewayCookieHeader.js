/**
 * Safeway Cookie header builder for native instore API calls.
 * Filters bloated session cookies (SWY_SHARED_SESSION) and enforces a size budget to avoid HTTP 431.
 */

export const COOKIE_HEADER_MAX_BYTES = 4096;

const DEV_LOG_URL = 'http://localhost:5000/api/dev/log';

/** Large JSON session blobs — access token is sent in POST body, not Cookie. */
const COOKIE_DENYLIST = new Set(['SWY_SHARED_SESSION', 'SWY_SHARED_SESSION_INFO']);

/** Max value length for ACI_S_* cookies included in Cookie header. */
const ACI_S_MAX_VALUE_LEN = 512;

export function isDeniedSafewayCookieKey(key) {
  return COOKIE_DENYLIST.has(key);
}

export function isWafSafewayCookieKey(key) {
  if (!key || typeof key !== 'string') return false;
  return (
    key === 'JSESSIONID' ||
    key === 'abs_gsession' ||
    key.startsWith('akacd_PR-') ||
    key.startsWith('visid_incap_') ||
    key.startsWith('nlbi_') ||
    key.startsWith('incap_ses_')
  );
}

/**
 * @param {string} key
 * @param {'full' | 'waf-only'} [tier='full']
 */
export function isAllowedSafewayCookieKey(key, tier = 'full') {
  if (!key || typeof key !== 'string') return false;
  if (isDeniedSafewayCookieKey(key)) return false;
  if (isWafSafewayCookieKey(key)) return true;
  if (tier === 'waf-only') return false;
  if (key.startsWith('ACI_S_')) return true;
  return false;
}

function pairHeaderLength(pairs) {
  if (!pairs.length) return 0;
  return pairs.map(([k, v]) => `${k}=${String(v)}`).join('; ').length;
}

function applyCookieHeaderBudget(pairs, maxBytes) {
  if (!pairs.length) return pairs;
  const waf = pairs.filter(([k]) => isWafSafewayCookieKey(k));
  const other = pairs
    .filter(([k]) => !isWafSafewayCookieKey(k))
    .sort((a, b) => String(a[1]).length - String(b[1]).length);
  let selected = [...waf, ...other];

  while (selected.length > 0 && pairHeaderLength(selected) > maxBytes) {
    let dropIdx = -1;
    for (let i = selected.length - 1; i >= 0; i--) {
      if (!isWafSafewayCookieKey(selected[i][0])) {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx < 0 && selected.length > 1) {
      dropIdx = selected.length - 1;
    }
    if (dropIdx < 0) break;
    selected = selected.filter((_, i) => i !== dropIdx);
  }
  return selected;
}

/**
 * @param {Record<string, string>} cookies
 * @param {{ tier?: 'full' | 'waf-only', maxBytes?: number }} [opts]
 * @returns {string|undefined}
 */
export function buildCookieHeader(cookies, opts = {}) {
  const tier = opts.tier ?? 'full';
  const maxBytes = opts.maxBytes ?? COOKIE_HEADER_MAX_BYTES;
  if (!cookies || typeof cookies !== 'object') return undefined;

  const pairs = Object.entries(cookies).filter(([k, v]) => {
    if (v == null || String(v).length === 0) return false;
    if (!isAllowedSafewayCookieKey(k, tier)) return false;
    if (k.startsWith('ACI_S_') && String(v).length > ACI_S_MAX_VALUE_LEN) return false;
    return true;
  });

  if (!pairs.length) return undefined;
  const budgeted = applyCookieHeaderBudget(pairs, maxBytes);
  if (!budgeted.length) return undefined;
  return budgeted.map(([k, v]) => `${k}=${String(v)}`).join('; ');
}

/** Parse a Cookie header string back into a key/value map (best-effort). */
export function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Retry tiers for 431 responses: full header → WAF-only → token-only (no Cookie).
 * @param {string|undefined} cookieHeader
 * @returns {Array<{ tier: string, cookieHeader?: string }>}
 */
export function cookieHeaderRetryTiers(cookieHeader) {
  const tiers = [];
  if (cookieHeader) {
    tiers.push({ tier: 'full', cookieHeader });
    const wafOnly = buildCookieHeader(parseCookieHeader(cookieHeader), { tier: 'waf-only' });
    if (wafOnly && wafOnly !== cookieHeader) {
      tiers.push({ tier: 'waf-only', cookieHeader: wafOnly });
    }
  }
  tiers.push({ tier: 'token-only', cookieHeader: undefined });
  return tiers;
}

/** Dev-only diagnostics (no cookie values). */
export function logSafewayListFetchDiagnostics({ tier, cookieHeader, keys }) {
  try {
    const keyList = keys ?? (cookieHeader ? Object.keys(parseCookieHeader(cookieHeader)) : []);
    const msg = JSON.stringify({
      tier: tier ?? 'unknown',
      cookieHeaderLength: cookieHeader?.length ?? 0,
      keys: keyList,
    });
    fetch(DEV_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `safewayListFetch|${msg}`,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
