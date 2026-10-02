import { useEffect, useState } from 'react'
import { PROVIDER_LABELS, subscribe } from '../services/providerAttentionStore'
import { getStoreConnectionDisplay } from '../utils/storeConnectionDisplay'

/**
 * Shared chrome for Safeway / Costco store connector cards.
 *
 * @param {{
 *   provider: 'safeway' | 'costco',
 *   hasStoredTokens: boolean,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export default function StoreConnectorCard({
  provider,
  hasStoredTokens,
  className = '',
  children,
}) {
  const [attentionKind, setAttentionKind] = useState(undefined)

  useEffect(() => {
    return subscribe((items) => {
      setAttentionKind(items[provider]?.kind)
    })
  }, [provider])

  const storeName = PROVIDER_LABELS[provider] || provider
  const display = getStoreConnectionDisplay(provider, hasStoredTokens, attentionKind)

  return (
    <div className={`card ${className}`.trim()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-display font-semibold text-cream">{storeName}</h3>
        <span
          className={`px-2 py-1 text-xs rounded-full ${display.badgeClassName}`}
        >
          {display.kind === 'connected' ? `✓ ${display.badge}` : display.badge}
        </span>
      </div>
      <p className="text-sage-light text-sm mb-4">{display.body}</p>
      <div className="space-y-4">{children}</div>
    </div>
  )
}
