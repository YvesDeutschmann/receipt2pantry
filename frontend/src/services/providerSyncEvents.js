/**
 * Provider sync event bus — window CustomEvents consumed by ReconnectBanner,
 * future useAppSyncScheduler telemetry, etc.
 */

/**
 * @param {'safeway' | 'costco'} provider
 * @param {{ tier: string, receipts_stored: number, items_added: number }} detail
 */
export function dispatchProviderSyncCompleted(provider, { tier, receipts_stored, items_added }) {
  window.dispatchEvent(
    new CustomEvent(`${provider}-sync-completed`, {
      detail: { tier, receipts_stored, items_added },
    })
  );
}
