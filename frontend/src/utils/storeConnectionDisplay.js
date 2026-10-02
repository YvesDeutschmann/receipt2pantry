import { PROVIDER_LABELS } from '../services/providerAttentionStore'

/**
 * @typedef {'not_connected' | 'connected' | 'needs_reconnect'} StoreConnectionKind
 */

/**
 * @param {'safeway' | 'costco'} provider
 * @param {boolean} hasStoredTokens
 * @param {string | undefined} attentionKind
 * @returns {{ kind: StoreConnectionKind, badge: string, body: string, badgeClassName: string }}
 */
export function getStoreConnectionDisplay(provider, hasStoredTokens, attentionKind) {
  const storeName = PROVIDER_LABELS[provider] || provider
  const needsReconnect = attentionKind === 'needs_reconnect'

  if (needsReconnect) {
    return {
      kind: 'needs_reconnect',
      badge: 'Needs reconnect',
      body: `Your ${storeName} session expired. Reconnect to keep receipts syncing.`,
      badgeClassName: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
    }
  }

  if (hasStoredTokens) {
    return {
      kind: 'connected',
      badge: 'Connected',
      body: `Your ${storeName} account is connected and ready to fetch receipts.`,
      badgeClassName: 'bg-forest-light text-sage',
    }
  }

  return {
    kind: 'not_connected',
    badge: 'Not connected',
    body: `Connect your ${storeName} account to automatically fetch receipts.`,
    badgeClassName: 'bg-forest-light text-sage-light',
  }
}
