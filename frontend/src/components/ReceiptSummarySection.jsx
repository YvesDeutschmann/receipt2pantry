import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/apiClient'
import PullToRefresh from './PullToRefresh'

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

  const handleRefresh = async () => {
    setLoading(true)
    try {
      await loadSummary()
    } catch {
      setError('Failed to load receipts')
    } finally {
      setLoading(false)
    }
  }

  const receipts = summary.recent

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        <h2 className="text-xl font-display font-semibold text-cream mb-4">Your receipts</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <h3 className="text-sm font-medium text-sage-light mb-2">Total Receipts</h3>
            <p className="text-3xl font-display font-bold text-cream">{summary.total_receipts}</p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-sage-light mb-2">This Month</h3>
            <p className="text-3xl font-display font-bold text-cream">
              {formatUsd(summary.month_spend)}
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-medium text-sage-light mb-2">Total Items</h3>
            <p className="text-3xl font-display font-bold text-cream">{summary.total_items}</p>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Recent Receipts</h2>
          {loading ? (
            <div className="text-center py-8 text-sage-light">Loading...</div>
          ) : error ? (
            <div className="text-center py-8 text-[var(--color-error)]">{error}</div>
          ) : receipts.length === 0 ? (
            <div className="text-center py-8 text-sage-light">
              <p className="mb-4">No receipts yet!</p>
              <p className="text-sm">
                Configure a provider to start syncing your grocery receipts.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {receipts.map((receipt) => (
                <div key={receipt.id} className="border border-forest-light rounded-meald-md p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-cream">{receipt.provider}</h3>
                      <p className="text-sm text-sage-light">{receipt.order_date}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-cream">${receipt.total_amount}</p>
                      <p className="text-sm text-sage-light">{receipt.num_items} items</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  )
}
