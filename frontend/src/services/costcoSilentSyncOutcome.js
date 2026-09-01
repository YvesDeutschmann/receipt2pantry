/**
 * Shared outcome handling for Costco silent sync results (hook + scheduler).
 */

import { isTerminalRefreshError } from './costcoTokenRefresh';

export const COSTCO_RECONNECT_MESSAGE =
  'Costco session expired. Please sign in to Costco again.';

export const COSTCO_FETCH_MISS_MESSAGE =
  'Could not load Costco receipts. Try Silent Sync again.';

const TERMINAL_REASON_RE =
  /invalid_grant|login_required|interaction_required|refresh_invalid_grant|refresh_login_required|refresh_interaction_required|refresh_clock_skew|refresh_http_/i;

/**
 * @param {string|undefined|null} reason
 * @returns {boolean}
 */
export function isTerminalCostcoSessionReason(reason) {
  if (!reason) return false;
  return TERMINAL_REASON_RE.test(String(reason));
}

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @returns {boolean}
 */
export function isTerminalSilentReconnectResult(result) {
  if (!result?.needs_reconnect) return false;
  return isTerminalCostcoSessionReason(result.reason);
}

/**
 * @param {Error|{ message?: string, code?: string, status?: number }} err
 * @returns {boolean}
 */
export function isTransientCostcoFailure(err) {
  if (!err) return false;
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status ?? err?.response?.status;

  if (isTerminalRefreshError(err) || isTerminalCostcoSessionReason(msg)) {
    return false;
  }

  // Meald app auth — not a Costco session death; preserve Costco tokens.
  if (status === 401 || status === 403) {
    return true;
  }
  if (status === 408 || status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }
  if (
    /network error|network|timeout|fetch.?failed|connection.?refused|offline|econnreset|enotfound|socket hang up/.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @returns {'skipped'|'needs_reconnect'|'tokens_only'|'synced'|'timeout'|null}
 */
export function classifyCostcoSilentResult(result) {
  if (!result) return 'timeout';
  if (result._skipped) return 'skipped';
  if (result.needs_reconnect) return 'needs_reconnect';
  if (result._tokensOnly) return 'tokens_only';
  return 'synced';
}

/**
 * @param {object|null|undefined} result
 * @returns {boolean}
 */
export function isCostcoSilentSuccess(result) {
  const kind = classifyCostcoSilentResult(result);
  if (kind === 'synced') {
    return Array.isArray(result?.receipts) && result.receipts.length > 0;
  }
  return false;
}
