import { useCallback, useEffect, useState } from 'react'
import {
  getCostcoDiagnosticSummary,
  subscribeCostcoDiagnostic,
  summarizeCostcoDiagnosticForDisplay,
} from '../services/costcoDiagnosticStore'
import { isCostcoDevDiagnosticsEnabled } from '../services/costcoDiagnosticSettings'

/**
 * On-device Costco token diagnostic summary (dev/QA). Avoids Chrome DevTools during login.
 */
export default function CostcoDiagnosticOverlay() {
  const [enabled] = useState(() => isCostcoDevDiagnosticsEnabled())
  const [expanded, setExpanded] = useState(false)
  const [summary, setSummary] = useState(() => getCostcoDiagnosticSummary())

  const refresh = useCallback(() => {
    setSummary(getCostcoDiagnosticSummary())
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    refresh()
    return subscribeCostcoDiagnostic(refresh)
  }, [enabled, refresh])

  if (!enabled) return null

  const pill = summarizeCostcoDiagnosticForDisplay(summary)
  const checkpoints = summary.checkpoints ?? {}
  const token = summary.tokenExchange?.flat

  return (
    <div
      data-testid="costco-diagnostic-overlay"
      className="fixed left-3 z-[80] max-w-[min(100%-1.5rem,22rem)] rounded-meald-md border border-amber-400/40 bg-forest/95 text-cream shadow-lg"
      style={{ bottom: 'calc(var(--safe-area-inset-bottom) + 4.5rem)' }}
    >
      <button
        type="button"
        className="w-full px-3 py-2 text-left text-xs font-medium"
        aria-label={expanded ? 'collapse costco diagnostic' : 'expand costco diagnostic'}
        onClick={() => setExpanded((open) => !open)}
      >
        {pill}
      </button>
      {expanded ? (
        <div className="border-t border-cream/10 px-3 pb-3 pt-2 space-y-2 text-[11px] text-sage-light">
          {['a0', 'a1', 'a2'].map((key) => {
            const cp = checkpoints[key]?.flat
            if (!cp) {
              return (
                <p key={key}>
                  {key.toUpperCase()}: not captured
                </p>
              )
            }
            return (
              <p key={key}>
                {key.toUpperCase()}: seen={cp.censusSeen ?? 0} id={cp.censusIdTokens ?? 0}{' '}
                acc={cp.censusAccessTokens ?? 0} exp={cp.censusExpired ?? 0} tfc=
                {cp.censusTokenFailureCount || '—'}
                {cp.censusTfp ? ` tfp=${cp.censusTfp}` : ''}
              </p>
            )
          })}
          {checkpoints['purge-expired']?.data ? (
            <p>Purge: removed {checkpoints['purge-expired'].data.removedCount ?? 0}</p>
          ) : null}
          {token ? (
            <p>
              /token: fired={String(token.tokenFired)} status={token.tokenStatus}{' '}
              {token.tokenPolicy ? `policy=${token.tokenPolicy}` : ''}
              {token.tokenError ? ` err=${token.tokenError}` : ''}
            </p>
          ) : (
            <p>/token: not captured</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
