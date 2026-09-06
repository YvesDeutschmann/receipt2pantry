import { useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Search } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../services/apiClient'

const DEBOUNCE_MS = 200

async function addHaptic() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* ignore */
  }
}

/**
 * Layer 2: canonical-only search + instant add.
 * @param {string} userId
 * @param {string[]} excludeBases - base_ingredient already in pantry / selected
 * @param {(info: object) => void} [onAdded]
 * @param {() => import('react').ReactNode} [renderRight] - e.g. L3 mic slot
 */
export default function IngredientSearchInput({
  userId,
  excludeBases = [],
  onAdded,
  renderRight,
  autoFocus = true,
  className = '',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [justAdded, setJustAdded] = useState(null)
  const [optionalQty, setOptionalQty] = useState(null)
  const [qtyValue, setQtyValue] = useState('')
  const [adding, setAdding] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  const runSearch = useCallback(
    async (q) => {
      const trimmed = q.trim()
      if (trimmed.length < 2) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const data = await api.searchIngredients(trimmed, excludeBases, 6)
        setResults(data.results || [])
      } catch (e) {
        console.error(e)
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [excludeBases]
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      runSearch(trimmed)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch, excludeBases])

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [autoFocus])

  const handlePick = async (row) => {
    if (!userId || adding) return
    setAdding(true)
    setOptionalQty(null)
    setQtyValue('')
    try {
      await addHaptic()
      const out = await api.quickAddPantryItem(userId, row.base_ingredient)
      const label = out.item?.display_name || row.display_name
      setJustAdded({ label, itemId: out.item_id, base: row.base_ingredient })
      setQuery('')
      setResults([])
      onAdded?.(out)
    } catch (e) {
      console.error(e)
    } finally {
      setAdding(false)
    }
  }

  const showNoMatch =
    query.trim().length >= 2 && !loading && results.length === 0 && !justAdded

  return (
    <div className={className}>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-sage-light pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="What else is in your kitchen?"
            value={query}
            onChange={(e) => {
              setJustAdded(null)
              setQuery(e.target.value)
            }}
            className="input pl-10 w-full"
            disabled={adding}
          />
        </div>
        {typeof renderRight === 'function' ? renderRight() : null}
      </div>

      <AnimatePresence mode="wait">
        {justAdded && (
          <motion.p
            key={justAdded.label}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-sm text-terra font-medium"
          >
            {justAdded.label} added ✓
          </motion.p>
        )}
      </AnimatePresence>

      {justAdded && !optionalQty && (
        <button
          type="button"
          className="mt-2 text-xs text-sage-light hover:text-cream underline-offset-2"
          onClick={() => {
            setOptionalQty(justAdded.itemId)
            setQtyValue('')
          }}
        >
          Add quantity (optional)
        </button>
      )}

      {optionalQty && justAdded?.itemId === optionalQty && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="Amount"
            value={qtyValue}
            onChange={(e) => setQtyValue(e.target.value)}
            className="input w-28 py-2 text-sm"
          />
          <button
            type="button"
            className="btn btn-ghost text-sm py-1"
            onClick={async () => {
              const n = parseFloat(qtyValue)
              if (!userId || !optionalQty || Number.isNaN(n) || n < 0) return
              try {
                await api.updatePantryItem(userId, optionalQty, n)
                setOptionalQty(null)
                setQtyValue('')
              } catch (e) {
                console.error(e)
              }
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="text-xs text-sage-light"
            onClick={() => {
              setOptionalQty(null)
              setQtyValue('')
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && query.trim().length >= 2 && (
        <p className="mt-2 text-xs text-sage-light">Searching…</p>
      )}

      {showNoMatch && (
        <p className="mt-2 text-sm text-sage-light">
          We don&apos;t recognize that yet — try a different name
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 rounded-meald-md border border-sage/25 bg-forest-mid/80 overflow-hidden max-h-64 overflow-y-auto">
          {results.map((r) => (
            <li key={r.base_ingredient}>
              <button
                type="button"
                disabled={adding}
                onClick={() => handlePick(r)}
                className="w-full text-left px-4 py-3 text-sm text-cream hover:bg-forest-light/80 border-b border-sage/15 last:border-0 disabled:opacity-50"
              >
                <span className="font-medium">{r.display_name}</span>
                {r.category && (
                  <span className="block text-xs text-sage-light mt-0.5">{r.category}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
