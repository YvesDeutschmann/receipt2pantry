import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/apiClient'
import SettingsGroup from './settings/SettingsGroup'

const EMPTY_SUMMARY = {
  total_receipts: 0,
  month_spend: 0,
  total_items: 0,
  recent: [],
}

function formatUsd(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${n.toFixed(2)}`
}

/**
 * Per-user receipt totals and recent list (01e.3). Host: Settings.
 * @param {{ userId: string | undefined }} props
 */
export default function ReceiptSummarySection({ userId }) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadSummary = useCallback(async () => {
    if (!userId) return
    setError(null)
    const data = await api.getReceiptSummary(userId)
    setSummary({
      total_receipts: data?.total_receipts ?? 0,
      month_spend: data?.month_spend ?? 0,
      total_items: data?.total_items ?? 0,
      recent: Array.isArray(data?.recent) ? data.recent : [],
    })
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await loadSummary()
      } catch {
        if (!cancelled) setError('Failed to load receipts')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, loadSummary])

  const receipts = summary.recent

  return (
    <SettingsGroup title="Receipts">
      <div className="px-4 py-4">
        {loading ? (
          <div className="text-center py-4 text-sage-light text-sm">Loading…</div>
        ) : error ? (
          <div className="text-center py-4 text-[var(--color-error)] text-sm">{error}</div>
        ) : (
          <>
            <div className="flex justify-between gap-4 text-center mb-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sage-light mb-1">Receipts</p>
                <p className="text-xl font-display font-bold text-cream tabular-nums">
                  {summary.total_receipts}
                </p>
              </div>
              <div className="flex-1 min-w-0 border-x border-forest-light/60 px-2">
                <p className="text-xs text-sage-light mb-1">This month</p>
                <p className="text-xl font-display font-bold text-cream tabular-nums">
                  {formatUsd(summary.month_spend)}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-sage-light mb-1">Items</p>
                <p className="text-xl font-display font-bold text-cream tabular-nums">
                  {summary.total_items}
                </p>
              </div>
            </div>

            {receipts.length === 0 ? (
              <p className="text-sm text-sage-light text-center py-2">
                No receipts yet. Connect a store to start syncing.
              </p>
            ) : (
              <ul className="divide-y divide-forest-light/60 -mx-4">
                {receipts.map((receipt) => (
                  <li
                    key={receipt.id}
                    className="flex justify-between items-start gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-cream capitalize">{receipt.provider}</p>
                      <p className="text-xs text-sage-light">{receipt.order_date}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-medium text-cream">${receipt.total_amount}</p>
                      <p className="text-xs text-sage-light">{receipt.num_items} items</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </SettingsGroup>
  )
}
