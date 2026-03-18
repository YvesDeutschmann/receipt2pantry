import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'

function Dashboard() {
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // For demo purposes, we'll skip actual API calls
    // In production, you would call: api.getReceipts(userId)
    setLoading(false)
  }, [])

  const handleRefresh = async () => {
    setLoading(true)
    try {
      // In production: await api.getReceipts(userId)
      await new Promise((r) => setTimeout(r, 500))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome to Meald! View your recent receipts and shopping statistics."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="card">
          <h3 className="text-sm font-medium text-sage-light mb-2">Total Receipts</h3>
          <p className="text-3xl font-display font-bold text-cream">0</p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-sage-light mb-2">This Month</h3>
          <p className="text-3xl font-display font-bold text-cream">$0.00</p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-sage-light mb-2">Total Items</h3>
          <p className="text-3xl font-display font-bold text-cream">0</p>
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
              <div key={receipt.id} className="border border-forest-light rounded-mise-md p-4">
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
    </div></PullToRefresh>
  )
}

export default Dashboard

