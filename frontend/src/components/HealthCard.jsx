import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../services/apiClient'

const MAX_ITEMS = 5

/**
 * @param {{
 *   userId: string,
 *   items: Array<{
 *     item_id: string,
 *     base_ingredient: string,
 *     normalized_name: string,
 *     confidence: number,
 *     depletion_class: string,
 *   }>,
 *   visible: boolean,
 *   onDismiss: () => void,
 *   onItemUpdated: () => void,
 * }} props
 */
export default function HealthCard({ userId, items, visible, onDismiss, onItemUpdated }) {
  const [localItems, setLocalItems] = useState([])
  const [stillHaveDoneId, setStillHaveDoneId] = useState(null)
  const prevLocalCountRef = useRef(undefined)

  useEffect(() => {
    if (visible) {
      setLocalItems((items || []).slice(0, MAX_ITEMS))
      setStillHaveDoneId(null)
      prevLocalCountRef.current = undefined
    } else {
      setLocalItems([])
      setStillHaveDoneId(null)
      prevLocalCountRef.current = undefined
    }
  }, [visible, items])

  const finishDismiss = useCallback(async () => {
    try {
      await api.dismissHealthCard(userId)
    } catch (e) {
      console.error('dismissHealthCard failed', e)
    }
    onDismiss()
    await Promise.resolve(onItemUpdated?.())
  }, [userId, onDismiss, onItemUpdated])

  useEffect(() => {
    if (!visible) {
      prevLocalCountRef.current = undefined
      return
    }
    const n = localItems.length
    const prev = prevLocalCountRef.current
    prevLocalCountRef.current = n
    if (prev !== undefined && prev > 0 && n === 0) {
      void (async () => {
        try {
          await api.dismissHealthCard(userId)
        } catch (e) {
          console.error('dismissHealthCard (auto) failed', e)
        }
        onDismiss()
        await Promise.resolve(onItemUpdated?.())
      })()
    }
  }, [visible, localItems.length, userId, onDismiss, onItemUpdated])

  const labelFor = (row) => {
    const n = row.normalized_name?.trim()
    const b = row.base_ingredient?.trim()
    return n || b || 'Item'
  }

  const removeItem = (itemId) => {
    setLocalItems((prev) => prev.filter((i) => i.item_id !== itemId))
  }

  const handleStillHaveIt = async (row) => {
    try {
      await api.correctPantryItem(userId, row.item_id, 'still_have_it')
      setStillHaveDoneId(row.item_id)
      window.setTimeout(() => {
        removeItem(row.item_id)
        setStillHaveDoneId(null)
        void onItemUpdated?.()
      }, 450)
    } catch (e) {
      console.error('still_have_it failed', e)
    }
  }

  const handleUsedUp = async (row) => {
    try {
      await api.correctPantryItem(userId, row.item_id, 'used_it_up')
      removeItem(row.item_id)
      void onItemUpdated?.()
    } catch (e) {
      console.error('used_it_up failed', e)
    }
  }

  if (!visible) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="mt-6 bg-forest-mid border border-sage/30 rounded-meald-lg p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-lg font-display font-semibold text-cream">Quick pantry check</h3>
            <span className="text-sm text-sage-light">30 seconds</span>
          </div>

          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {localItems.map((row) => (
                <motion.li
                  key={row.item_id}
                  layout
                  exit={{ opacity: 0, x: 40, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden flex items-center justify-between gap-3"
                >
                  <span className="text-cream min-w-0 truncate">{labelFor(row)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {stillHaveDoneId === row.item_id ? (
                      <span className="text-emerald-400 text-lg px-2" aria-hidden>
                        ✓
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-xs rounded-meald-md border border-emerald-600/50 text-emerald-200 hover:bg-emerald-900/20"
                          onClick={() => handleStillHaveIt(row)}
                        >
                          Still have it
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 text-sm text-sage-light hover:text-cream rounded-meald-md border border-sage/25"
                          onClick={() => handleUsedUp(row)}
                          aria-label="Used it up"
                        >
                          ✗
                        </button>
                      </>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <div className="flex justify-end mt-4">
            <button type="button" className="btn btn-secondary text-sm" onClick={() => void finishDismiss()}>
              Done, thanks
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
