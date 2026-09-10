/**
 * Provider sync event bus — window CustomEvents consumed by ReconnectBanner,
 * useAppSyncScheduler telemetry, SyncToastHost, etc.
 */

/**
 * @param {'safeway' | 'costco'} provider
 * @param {{ tier: string, receipts_stored: number, items_added: number, outcome: string }} detail
 */
export function dispatchProviderSyncCompleted(provider, { tier, receipts_stored, items_added, outcome }) {
  window.dispatchEvent(
    new CustomEvent(`${provider}-sync-completed`, {
      detail: { tier, receipts_stored, items_added, outcome },
    })
  );
}

/**
 * @param {'safeway' | 'costco'} provider
 * @param {{ reason?: string, message?: string }} detail
 */
export function dispatchProviderSyncFailed(provider, { reason, message }) {
  window.dispatchEvent(
    new CustomEvent(`${provider}-sync-error`, {
      detail: { reason, message, outcome: 'failed' },
    })
  );
}
