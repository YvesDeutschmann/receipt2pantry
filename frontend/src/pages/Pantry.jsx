import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Package, Mic } from 'lucide-react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import PantryList from '../components/PantryList'
import PantrySearchOverlay from '../components/PantrySearchOverlay'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'
import VoiceInputSheet from '../components/voice/VoiceInputSheet'
import GraveyardSection from '../components/GraveyardSection'

function Pantry() {
  const [pantryData, setPantryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [householdId, setHouseholdId] = useState(null)

  const { user } = useAuth()
  const userId = user?.id

  const fetchPantry = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPantry(userId, householdId)
      setPantryData(data)
    } catch (err) {
      console.error('Failed to fetch pantry:', err)
      setError('Failed to load pantry. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [userId, householdId])

  const fetchHousehold = useCallback(async () => {
    if (!userId) return
    try {
      const response = await api.getHousehold(userId)
      if (response.household) {
        setHouseholdId(response.household.id)
      }
    } catch (err) {
      console.error('Failed to fetch household:', err)
    }
  }, [userId])

  useEffect(() => {
    fetchHousehold()
  }, [fetchHousehold])

  useEffect(() => {
    if (userId && householdId) {
      fetchPantry()
    }
  }, [userId, householdId, fetchPantry])

  const activeItems = useMemo(() => {
    const rows = pantryData?.items || []
    return rows.filter((i) => !i.deleted_at)
  }, [pantryData])

  const excludeBases = useMemo(() => {
    const s = new Set()
    for (const i of activeItems) {
      if (i.base_ingredient) s.add(String(i.base_ingredient).toLowerCase())
    }
    return [...s]
  }, [activeItems])

  const filteredItems = useMemo(() => {
    if (!searchTerm) return activeItems
    const term = searchTerm.toLowerCase()
    return activeItems.filter(
      (i) =>
        i.normalized_name?.toLowerCase().includes(term) ||
        i.base_ingredient?.toLowerCase().includes(term) ||
        i.category?.toLowerCase().includes(term)
    )
  }, [activeItems, searchTerm])

  const handleCorrection = async (itemId, action) => {
    try {
      await api.correctPantryItem(userId, itemId, action)
      await fetchPantry()
    } catch (err) {
      console.error('Correction failed:', err)
      setError('Failed to update item.')
    }
  }

  const handleRemove = async (itemId) => {
    try {
      await api.correctPantryItem(userId, itemId, 'used_it_up')
      await fetchPantry()
    } catch (err) {
      console.error('Remove failed:', err)
      setError('Failed to remove item.')
    }
  }

  return (
    <PullToRefresh onRefresh={fetchPantry}>
      <div>
        <PageHeader
          title="Pantry"
          subtitle="Track your ingredients and see what you have on hand."
          actions={
            <button
              type="button"
              onClick={() => setSearchOverlayOpen(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add item
            </button>
          }
        />

        {pantryData && activeItems.length > 0 ? (
          <p className="text-sage-light text-sm mb-6">
            {activeItems.length} {activeItems.length === 1 ? 'item' : 'items'} in your pantry
          </p>
        ) : null}

        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              placeholder="Search pantry..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10"
            />
            <Search className="absolute left-3 top-3.5 w-5 h-5 text-sage-light" />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-3.5 text-sage-light hover:text-cream"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 border border-[var(--color-error)] rounded-mise-md text-[var(--color-error)] bg-[var(--color-error)]/10">
            {error}
            <button type="button" onClick={() => setError(null)} className="ml-2 underline hover:no-underline">
              Dismiss
            </button>
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
            </div>
          ) : !pantryData || activeItems.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto w-16 h-16 bg-forest-light rounded-full flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-sage-light" />
              </div>
              <h3 className="text-lg font-display font-medium text-cream mb-2">Your pantry is empty</h3>
              <p className="text-sage-light mb-4">
                Add items from our ingredient list or sync receipts from your grocery store.
              </p>
              <button type="button" onClick={() => setAddMenuOpen(true)} className="btn btn-primary">
                Add your first item
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sage-light">No items match your search.</p>
            </div>
          ) : (
            <PantryList items={filteredItems} onCorrection={handleCorrection} onRemove={handleRemove} />
          )}
        </div>

        {userId ? (
          <GraveyardSection userId={userId} householdId={householdId} onPutBack={fetchPantry} />
        ) : null}

        <PantrySearchOverlay
          isOpen={searchOverlayOpen}
          onClose={() => setSearchOverlayOpen(false)}
          userId={userId}
          excludeBases={excludeBases}
          onAdded={fetchPantry}
          onOpenVoice={() => setVoiceOpen(true)}
        />

        <VoiceInputSheet
          isOpen={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          userId={userId}
          excludeBases={excludeBases}
          onPantryRefresh={fetchPantry}
        />

        <AnimatePresence>
          {addMenuOpen ? (
            <motion.div
              key="add-pantry-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Add to pantry"
              className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAddMenuOpen(false)}
            >
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 16, opacity: 0 }}
                className="w-full max-w-sm rounded-mise-lg bg-forest-mid border border-sage/30 p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-cream font-display font-semibold mb-3">Add to pantry</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                    onClick={() => {
                      setAddMenuOpen(false)
                      setSearchOverlayOpen(true)
                    }}
                  >
                    <Search className="w-5 h-5" />
                    Search
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-mise-md border border-sage/30 text-cream hover:bg-forest-light"
                    onClick={() => {
                      setAddMenuOpen(false)
                      setVoiceOpen(true)
                    }}
                  >
                    <Mic className="w-5 h-5 text-terra" />
                    Tell me
                  </button>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </PullToRefresh>
  )
}

export default Pantry
