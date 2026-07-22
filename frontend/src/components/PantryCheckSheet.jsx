import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { api } from '../services/apiClient'
import { incrementPantryCheckSessionDismissals } from '../utils/pantryCheck'

/**
 * Bottom sheet: quick pantry check for 1–3 missed ingredients (meal plan accept, etc.)
 */
export default function PantryCheckSheet({
  open,
  onClose,
  userId,
  recipeTitle,
  missedItems,
}) {
  const [busy, setBusy] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set())
  const [substitutions, setSubstitutions] = useState({})

  const missed = missedItems || []

  const handleAbandonPrompt = useCallback(() => {
    incrementPantryCheckSessionDismissals()
    onClose?.()
  }, [onClose])

  const handleFinished = useCallback(() => {
    onClose?.()
  }, [onClose])

  const visible = useMemo(
    () =>
      missed.filter((m) => !dismissed.has(String(m.name || m.original || '').trim())),
    [missed, dismissed]
  )

  useEffect(() => {
    if (!open || missed.length === 0) return
    if (visible.length === 0) {
      handleFinished()
    }
  }, [open, missed.length, visible.length, handleFinished])

  useEffect(() => {
    if (!open) setSubstitutions({})
  }, [open])

  useEffect(() => {
    if (!open || !userId || missed.length === 0) return
    setSubstitutions({})

    missed.forEach(async (item) => {
      const key = String(item.name || item.original || '').trim()
      if (!key) return
      try {
        const result = await api.getIngredientSubstitutions(userId, key)
        const first = result.substitutes?.[0]
        setSubstitutions((prev) => ({
          ...prev,
          [key]: first ? first.substitute : null,
        }))
      } catch {
        // silent
      }
    })
  }, [open, userId, missed.length])

  const resolveAndAdd = async (ing) => {
    const q = String(ing.name || ing.original || '').trim()
    if (!q || !userId) return
    setBusy(q)
    try {
      const { results } = await api.searchIngredients(q, [], 1)
      if (results?.[0]?.base_ingredient) {
        await api.quickAddPantryItem(userId, results[0].base_ingredient)
      }
      setDismissed((d) => new Set(d).add(q))
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(null)
    }
  }

  const markDismissed = (ing) => {
    const k = String(ing.name || ing.original || '').trim()
    setDismissed((d) => new Set(d).add(k))
  }

  if (!open || missed.length === 0) {
    return null
  }

  return (
    <AnimatePresence>
      {visible.length > 0 && (
        <>
          <motion.button
            type="button"
            aria-label="Dismiss"
            className="fixed inset-0 z-[80] bg-forest/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleAbandonPrompt}
          />
          <motion.div
            role="dialog"
            aria-labelledby="pantry-check-title"
            className="fixed bottom-0 left-0 right-0 z-[90] max-h-[70vh] overflow-y-auto rounded-t-2xl bg-forest-mid border-t border-sage/25 shadow-mise-lg pb-safe"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          >
            <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-sage/20 bg-forest-mid">
              <h2 id="pantry-check-title" className="text-cream font-display font-semibold text-base">
                Quick pantry check
              </h2>
              <button
                type="button"
                onClick={handleAbandonPrompt}
                className="p-2 text-sage-light hover:text-cream rounded-mise-md"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {recipeTitle && (
              <p className="px-4 pt-2 text-xs text-sage-light line-clamp-2">{recipeTitle}</p>
            )}
            <ul className="px-4 py-3 space-y-3">
              {visible.map((ing, idx) => {
                const label = ing.original || ing.name || 'Ingredient'
                const itemKey = String(ing.name || ing.original || '').trim()
                const key = `${idx}-${label}`
                const isBusy = busy === itemKey
                const sub = substitutions[itemKey]
                return (
                  <li
                    key={key}
                    className="rounded-mise-md border border-sage/25 bg-forest/40 p-3"
                  >
                    <p className="text-sm text-cream font-medium mb-2 line-clamp-2">{label}</p>
                    {sub && (
                      <span className="text-xs text-sage-light block mt-0.5 mb-2">
                        or: {sub}
                      </span>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => resolveAndAdd(ing)}
                        className="btn btn-primary text-xs py-1.5 px-3"
                      >
                        I have it
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => markDismissed(ing)}
                        className="btn btn-ghost text-xs py-1.5 px-3 border border-sage/30"
                      >
                        I&apos;ll buy it
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => markDismissed(ing)}
                        className="text-xs text-sage-light underline px-2 py-1.5"
                      >
                        Skip
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
