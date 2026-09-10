import { classifyCostcoSilentResult } from './costcoSilentSyncOutcome';
import { classifySafewaySilentResult } from './safewaySilentSyncOutcome';

export const SYNC_OUTCOMES = {
  COMPLETED_EMPTY: 'completed_empty',
  COMPLETED_ITEMS: 'completed_items',
  FAILED: 'failed',
  NEEDS_RECONNECT: 'needs_reconnect',
  SKIPPED: 'skipped',
};

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @returns {{ outcome: string, receipts: object[], reason?: string }}
 */
export function mapCostcoSilentToOutcome(result) {
  const kind = classifyCostcoSilentResult(result);

  if (kind === 'skipped') {
    return { outcome: SYNC_OUTCOMES.SKIPPED, receipts: [], reason: result?.reason };
  }
  if (kind === 'needs_reconnect') {
    return { outcome: SYNC_OUTCOMES.NEEDS_RECONNECT, receipts: [], reason: result?.reason };
  }
  if (kind === 'timeout') {
    return { outcome: SYNC_OUTCOMES.FAILED, receipts: [], reason: 'silent_timeout' };
  }
  if (kind === 'tokens_only') {
    return { outcome: SYNC_OUTCOMES.FAILED, receipts: [], reason: 'tokens_only' };
  }

  const receipts = Array.isArray(result?.receipts) ? result.receipts : [];
  if (result?._fromWebView === true) {
    if (receipts.length === 0) {
      return { outcome: SYNC_OUTCOMES.COMPLETED_EMPTY, receipts: [] };
    }
    return { outcome: SYNC_OUTCOMES.COMPLETED_ITEMS, receipts };
  }

  return { outcome: SYNC_OUTCOMES.FAILED, receipts: [], reason: 'fetch_incomplete' };
}

/**
 * @param {object|null|undefined} result - startSilentSync() return value
 * @param {{ rawCount: number, parsedCount: number, fetchCompleted: boolean }} fetch
 * @returns {{ outcome: string, reason?: string }}
 */
export function mapSafewaySilentToOutcome(result, fetch) {
  const kind = classifySafewaySilentResult(result);

  if (kind === 'skipped') {
    return { outcome: SYNC_OUTCOMES.SKIPPED, reason: result?.reason };
  }
  if (kind === 'needs_reconnect') {
    return { outcome: SYNC_OUTCOMES.NEEDS_RECONNECT, reason: result?.reason };
  }
  if (kind === 'timeout') {
    return { outcome: SYNC_OUTCOMES.FAILED, reason: 'silent_timeout' };
  }
  if (kind === 'error') {
    return { outcome: SYNC_OUTCOMES.FAILED, reason: 'missing_club_card' };
  }

  if (!fetch || fetch.fetchCompleted !== true) {
    return { outcome: SYNC_OUTCOMES.FAILED, reason: 'fetch_incomplete' };
  }

  const rawCount = fetch.rawCount ?? 0;
  const parsedCount = fetch.parsedCount ?? 0;

  if (rawCount > 0 && parsedCount === 0) {
    return { outcome: SYNC_OUTCOMES.FAILED, reason: 'parse_all_dropped' };
  }
  if (parsedCount === 0) {
    return { outcome: SYNC_OUTCOMES.COMPLETED_EMPTY };
  }
  return { outcome: SYNC_OUTCOMES.COMPLETED_ITEMS };
}
