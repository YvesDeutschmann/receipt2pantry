/**
 * Shared outcome handling for Safeway silent sync results (hook + scheduler).
 */

export const SAFEWAY_RECONNECT_MESSAGE =
  'Safeway session expired. Please sign in again.';

export const SAFEWAY_TIMEOUT_MESSAGE =
  'Sync timed out. Check your connection and try Silent Sync again.';

export const SAFEWAY_MISSING_CLUB_MESSAGE =
  'Could not read your Safeway club card. Try Silent Sync again.';

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @returns {'skipped'|'needs_reconnect'|'synced'|'timeout'|'error'}
 */
export function classifySafewaySilentResult(result) {
  if (!result) return 'timeout';
  if (result._skipped) return 'skipped';
  if (result.needs_reconnect) return 'needs_reconnect';
  if (!result.accessToken) return 'needs_reconnect';
  if (!result.clubCard) return 'error';
  return 'synced';
}

/**
 * @param {object|null|undefined} result
 * @returns {boolean}
 */
export function isSafewaySilentExtractSuccess(result) {
  return classifySafewaySilentResult(result) === 'synced';
}
