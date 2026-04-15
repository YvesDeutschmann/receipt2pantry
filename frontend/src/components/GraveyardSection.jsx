import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/apiClient'

const GRAVEYARD_MS = 7 * 86400000

/** @param {string} deletedAt ISO date string */
export function relativeRemovalTime(deletedAt) {
  const days = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000)
  if (days === 0) return 'removed today'
  if (days === 1) return 'removed yesterday'
  return `removed ${days} days ago`
}

function isWithinGraveyardWindow(deletedAt) {
  const t = new Date(deletedAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t <= GRAVEYARD_MS
}

function displayName(baseIngredient) {
  if (!baseIngredient) return ''
  const s = String(baseIngredient)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function shouldHidePutBack(subClass, putBackCount) {
  const c = String(subClass || '')
  if ((c === 'raw_meat' || c === 'raw_fish') && putBackCount >= 1) return true
  return false
}

/**
 * @param {{
 *   userId: string,
 *   householdId: string | null,
 *   onPutBack: () => void,
 * }} props
 */
export default function GraveyardSection({ userId, householdId, onPutBack }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.getGraveyard(userId, householdId)
      const list = Array.isArray(data?.items) ? data.items : []
      setItems(list.filter((i) => i?.deleted_at && isWithinGraveyardWindow(i.deleted_at)))
    } catch (e) {
      console.error('Failed to load graveyard', e)
      setItems([])
    }
  }, [userId, householdId])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(() => {
    return [...items].sort(
      (a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
    )
  }, [items])

  const handlePutBack = async (depletionHistoryId) => {
    try {
      await api.putBack(userId, depletionHistoryId)
      setItems((prev) => prev.filter((i) => i.depletion_history_id !== depletionHistoryId))
      onPutBack()
      navigate('/recipes')
    } catch (err) {
      if (err.response?.status === 409) {
        return
      }
      console.error('Put back failed', err)
    }
  }

  if (sorted.length === 0) return null

  return (
    <div className="mt-10">
      <div className="border-t border-sage/30 mb-6" aria-hidden />
      <h3 className="text-lg font-display font-semibold text-cream mb-4">Recently Removed</h3>
      <ul className="space-y-0">
        <AnimatePresence initial={false}>
          {sorted.map((item, index) => {
            const id = item.depletion_history_id
            const hidePutBack = shouldHidePutBack(item.sub_class, item.put_back_count ?? 0)
            return (
              <motion.li
                key={id}
                layout
                exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-b border-sage/15 last:border-0 pb-4 mb-4 last:pb-0 last:mb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-cream font-medium">{displayName(item.base_ingredient)}</p>
                    <p className="text-sm text-sage-light mt-0.5">
                      {relativeRemovalTime(item.deleted_at)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {hidePutBack ? (
                      <span className="text-sm text-sage-light">Removed</span>
                    ) : (
                      <button
                        type="button"
                        className="px-3 py-1.5 text-sm rounded-mise-md border border-sage/40 text-cream hover:bg-forest-light"
                        onClick={() => void handlePutBack(id)}
                      >
                        Put back
                      </button>
                    )}
                  </div>
                </div>
                {index === 0 && (
                  <p className="text-xs text-sage-light mt-2 pl-0">
                    Put it back and we&apos;ll show you recipes to use it tonight
                  </p>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
