import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Search, Package, Mic } from 'lucide-react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import PantryList from '../components/PantryList'
import PantrySearchOverlay from '../components/PantrySearchOverlay'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'
import UndoToast from '../components/UndoToast'
import VoiceInputSheet from '../components/voice/VoiceInputSheet'

function Pantry() {
  const [pantryData, setPantryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [undo, setUndo] = useState(null)

  const { user } = useAuth()
  const userId = user?.id

  const fetchPantry = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getPantry(userId)
      setPantryData(data)
    } catch (err) {
      console.error('Failed to fetch pantry:', err)
      setError('Failed to load pantry. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchPantry()
  }, [fetchPantry])

  const excludeBases = useMemo(() => {
    const s = new Set()
    for (const g of pantryData?.grouped || []) {
      if (g.base_ingredient) s.add(String(g.base_ingredient).toLowerCase())
    }
    return [...s]
  }, [pantryData])

  const handleUpdateQuantity = async (itemId, newQuantity) => {
    try {
      await api.updatePantryItem(userId, itemId, newQuantity)
      fetchPantry()
    } catch (err) {
      console.error('Failed to update item:', err)
      setError('Failed to update item quantity.')
    }
  }

  const handleDeleteItem = async (itemId) => {
    try {
      const { snapshot } = await api.depletePantryItem(userId, itemId)
      const name =
        snapshot?.normalized_name || snapshot?.base_ingredient || 'Item'
      setUndo({ snapshot, message: `Removed ${name} from your pantry` })
      fetchPantry()
    } catch (err) {
      console.error('Failed to remove item:', err)
      setError('Failed to remove item.')
    }
  }

  const handleUndoDelete = async () => {
    if (!undo?.snapshot || !userId) return
    try {
      await api.restorePantryItem(userId, undo.snapshot)
      setUndo(null)
      fetchPantry()
    } catch (err) {
      console.error('Failed to undo:', err)
      setError('Could not restore item.')
    }
  }

  const getFilteredData = () => {
    if (!pantryData || !searchTerm) return pantryData

    const term = searchTerm.toLowerCase()
    const filteredGrouped = pantryData.grouped
      .map((group) => ({
        ...group,
        variants: group.variants.filter(
          (v) =>
            v.normalized_name?.toLowerCase().includes(term) ||
            v.base_ingredient?.toLowerCase().includes(term) ||
            v.category?.toLowerCase().includes(term)
        ),
      }))
      .filter((group) => group.variants.length > 0)

    return {
      ...pantryData,
      grouped: filteredGrouped,
      total_items: filteredGrouped.reduce((sum, g) => sum + g.variants.length, 0),
      unique_ingredients: filteredGrouped.length,
    }
  }

  const filteredData = getFilteredData()

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

        {pantryData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="card">
              <h3 className="text-sm font-medium text-sage-light mb-2">Total Items</h3>
              <p className="text-3xl font-display font-bold text-cream">{pantryData.total_items}</p>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-sage-light mb-2">Unique Ingredients</h3>
              <p className="text-3xl font-display font-bold text-cream">
                {pantryData.unique_ingredients}
              </p>
            </div>
            <div className="card">
              <h3 className="text-sm font-medium text-sage-light mb-2">Categories</h3>
              <p className="text-3xl font-display font-bold text-cream">
                {new Set(pantryData.items?.map((i) => i.category).filter(Boolean)).size}
              </p>
            </div>
          </div>
        )}

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
          ) : !pantryData || pantryData.total_items === 0 ? (
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
          ) : filteredData.total_items === 0 ? (
            <div className="text-center py-12">
              <p className="text-sage-light">No items match your search.</p>
            </div>
          ) : (
            <PantryList
              groupedItems={filteredData.grouped}
              onUpdateQuantity={handleUpdateQuantity}
              onDeleteItem={handleDeleteItem}
            />
          )}
        </div>

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

        <UndoToast
          open={Boolean(undo)}
          message={undo?.message || ''}
          onAction={handleUndoDelete}
          onDismiss={() => setUndo(null)}
        />
      </div>
    </PullToRefresh>
  )
}

export default Pantry
