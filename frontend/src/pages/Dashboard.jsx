import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/apiClient'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'
import PantrySearchOverlay from '../components/PantrySearchOverlay'
import NeedsAttentionSection from '../components/NeedsAttentionSection'

function Dashboard() {
  const { user } = useAuth()
  const userId = user?.id
  const whatsForDinnerUnlocked = Boolean(user?.user_metadata?.whats_for_dinner_unlocked)
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pantryBases, setPantryBases] = useState([])

  const loadPantryBases = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.getPantry(userId)
      const s = new Set()
      for (const g of data.grouped || []) {
        if (g.base_ingredient) s.add(String(g.base_ingredient).toLowerCase())
      }
      setPantryBases([...s])
    } catch {
      /* ignore */
    }
  }, [userId])

  const excludeBases = useMemo(() => pantryBases, [pantryBases])

  useEffect(() => {
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPantryBases()
  }, [loadPantryBases])

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

      <NeedsAttentionSection />

      {whatsForDinnerUnlocked && (
        <div className="mb-8 p-5 rounded-mise-lg border border-[var(--color-terra)]/35 bg-forest-light">
          <p className="text-cream font-display font-semibold mb-1">You&apos;re all set</p>
          <p className="text-sage-light text-sm mb-4">
            Your pantry baseline is saved — see what you can cook tonight.
          </p>
          <Link
            to="/recipes"
            className="btn btn-primary inline-flex items-center justify-center animate-pulse"
          >
            What&apos;s for Dinner
          </Link>
          <button
            type="button"
            onClick={() => {
              loadPantryBases()
              setSearchOpen(true)
            }}
            className="block w-full text-center text-sm text-sage-light hover:text-terra-light mt-4 underline underline-offset-2"
          >
            Missing something? Add it to your pantry →
          </button>
        </div>
      )}

      <PantrySearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        userId={userId}
        excludeBases={excludeBases}
        onAdded={() => loadPantryBases()}
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

