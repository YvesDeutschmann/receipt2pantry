/**
 * Costco silent-sync ingest: foreground gate + transient retry.
 */

import { submitToBackend } from './costcoNativeSync';
import { isTransientCostcoFailure } from './costcoSilentSyncOutcome';
import { waitForAppForegroundThenSettle } from './appForeground';

/**
 * @param {object[]} receipts
 * @param {string} userId
 * @param {object} [opts]
 * @param {() => string|null|undefined} [opts.getCurrentUserId]
 * @returns {Promise<object>}
 */
export async function submitSilentReceipts(receipts, userId, opts = {}) {
  const { getCurrentUserId } = opts;

  await waitForAppForegroundThenSettle({
    expectedUserId: userId,
    getCurrentUserId,
  });

  try {
    return await submitToBackend(receipts, userId);
  } catch (firstErr) {
    if (!isTransientCostcoFailure(firstErr)) {
      throw firstErr;
    }
    await waitForAppForegroundThenSettle({
      expectedUserId: userId,
      getCurrentUserId,
    });
    return submitToBackend(receipts, userId);
  }
}
