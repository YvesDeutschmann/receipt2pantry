import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Capacitor } from '@capacitor/core'
import {
  Check,
  ChevronDown,
  Circle,
  Mic,
  Receipt,
  Wheat,
  Flame,
  Package,
  UtensilsCrossed,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { useColdStart } from '../../contexts/ColdStartContext'
import { useOnboarding } from '../../contexts/OnboardingContext'
import { api } from '../../services/apiClient'
import ColdStartProgressBar from '../../components/ColdStartProgressBar'
import PantrySearchOverlay from '../../components/PantrySearchOverlay'
import VoiceInputSheet from '../../components/voice/VoiceInputSheet'

const CATEGORY_ICONS = {
  'Oils & Vinegars': Flame,
  'Baking Basics': Wheat,
  'Spices & Seasonings': UtensilsCrossed,
  'Canned & Jarred': Package,
  'Grains & Pasta': Wheat,
}

async function selectionHaptic() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* ignore */
  }
}

function StapleItemCard({
  item,
  selected,
  preSelected,
  receiptMatched,
  onToggle,
}) {
  const Icon = CATEGORY_ICONS[item.category] || Package

  return (
    <motion.button
      type="button"
      layout
      onClick={() => onToggle(item.base_ingredient)}
      className={[
        'relative w-full text-left rounded-mise-md border px-3 py-3 flex items-start gap-3 transition-colors',
        selected
          ? 'border-[var(--color-terra)] bg-[var(--color-forest-light)]'
          : 'border-sage/30 bg-forest-mid/50',
      ].join(' ')}
    >
      <span className="mt-0.5 text-sage-light">
        <Icon className="w-5 h-5" aria-hidden />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-cream font-medium text-sm">{item.display_name}</span>
          {receiptMatched && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-sage-light"
              title="Matched a recent receipt"
            >
              <Receipt className="w-3.5 h-3.5" aria-hidden />
            </span>
          )}
        </div>
        {preSelected && selected && (
          <p className="text-[11px] text-sage-light mt-1 leading-snug">
            We assumed you have these — tap to remove.
          </p>
        )}
      </div>
      <span className="shrink-0 text-terra mt-0.5">
        {selected ? (
          <Check className="w-5 h-5" strokeWidth={2.5} />
        ) : (
          <Circle className="w-5 h-5 text-sage-light" strokeWidth={2} />
        )}
      </span>
    </motion.button>
  )
}

function CategorySection({ name, items, selectedSet, preSelectedSet, receiptMatches, onToggle }) {
  const [open, setOpen] = useState(true)
  const count = items.length

  return (
    <div className="border border-sage/20 rounded-mise-md overflow-hidden mb-4 bg-forest-mid/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-cream font-display font-semibold text-sm">
          {name}{' '}
          <span className="text-sage-light font-normal">({count})</span>
        </span>
        <ChevronDown
          className={`w-5 h-5 text-sage-light transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-3 pb-3 space-y-2"
          >
            {items.map((item) => (
              <StapleItemCard
                key={item.id || item.base_ingredient}
                item={{ ...item, category: name }}
                selected={selectedSet.has(item.base_ingredient)}
                preSelected={preSelectedSet.has(item.base_ingredient)}
                receiptMatched={receiptMatches.has(item.base_ingredient.toLowerCase())}
                onToggle={onToggle}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function StaplesTemplate() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { complete } = useOnboarding()
  const { setReceiptSyncStatus, setReceiptMatchCount } = useColdStart()
  const userId = user?.id

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [preSelectedDefaults, setPreSelectedDefaults] = useState(() => new Set())
  const [receiptMatches, setReceiptMatches] = useState(() => new Set())
  const [toast, setToast] = useState(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [justUnlocked, setJustUnlocked] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [pantryBases, setPantryBases] = useState([])

  const initialSelectedRef = useRef(null)

  const isDirty = useMemo(() => {
    if (!initialSelectedRef.current) return false
    const a = initialSelectedRef.current
    if (a.size !== selected.size) return true
    for (const x of a) {
      if (!selected.has(x)) return true
    }
    return false
  }, [selected])

  useEffect(() => {
    if (!isDirty) return
    const fn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [isDirty])

  const loadTemplate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getStaplesTemplate()
      setCategories(data.categories || [])
      const pre = new Set()
      const sel = new Set()
      for (const cat of data.categories || []) {
        for (const it of cat.items || []) {
          if (it.pre_selected) {
            pre.add(it.base_ingredient)
            sel.add(it.base_ingredient)
          }
        }
      }
      setPreSelectedDefaults(pre)
      setSelected(sel)
      initialSelectedRef.current = new Set(sel)
    } catch (e) {
      console.error(e)
      setError(e.response?.data?.error || 'Could not load staples list.')
    } finally {
      setLoading(false)
    }
  }, [])

  const pollReceiptMatches = useCallback(async () => {
    try {
      setReceiptSyncStatus('syncing')
      const data = await api.getStaplesReceiptMatches()
      const matches = new Set((data.matches || []).map((m) => String(m).toLowerCase()))
      setReceiptMatches(matches)
      setReceiptMatchCount(matches.size)
      setReceiptSyncStatus('complete')
    } catch {
      setReceiptSyncStatus('idle')
    }
  }, [setReceiptMatchCount, setReceiptSyncStatus])

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

  const searchExcludeBases = useMemo(() => {
    const bases = new Set(pantryBases)
    for (const b of selected) bases.add(b.toLowerCase())
    return [...bases]
  }, [pantryBases, selected])

  useEffect(() => {
    loadTemplate()
  }, [loadTemplate])

  useEffect(() => {
    pollReceiptMatches()
    const t = setInterval(pollReceiptMatches, 8000)
    return () => clearInterval(t)
  }, [pollReceiptMatches])

  const toggle = (base) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(base)) next.delete(base)
      else next.add(base)
      return next
    })
    void selectionHaptic()
  }

  const fireSuggestionPoolWarmup = () => {
    if (!userId) return
    void api.suggestions
      .triggerGeneration(userId, { triggerReason: 'onboarding' })
      .catch(() => {})
  }

  const handleConfirm = async (opts = { skip: false }) => {
    if (!userId) return
    setSubmitting(true)
    setError(null)
    try {
      const list = opts.skip
        ? Array.from(preSelectedDefaults)
        : Array.from(selected)
      const result = await api.confirmStaples(userId, list, opts.skip)
      await complete()
      setJustUnlocked(true)
      const n = result.receipt_matched ?? 0
      if (n > 0) {
        setToast(`We matched ${n} of your staples to your recent receipts ✓`)
        setTimeout(() => setToast(null), 4500)
      }
      setTimeout(() => {
        navigate('/', { replace: true })
      }, n > 0 ? 600 : 0)
    } catch (e) {
      console.error(e)
      setError(
        e.response?.data?.error ||
          e.message ||
          'Could not save your pantry.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => {
    handleConfirm({ skip: true })
  }

  const savePartialAndLeave = async () => {
    if (!userId || !isDirty) {
      navigate('/onboarding/bridge', { replace: true })
      return
    }
    setSubmitting(true)
    try {
      await api.confirmStaples(userId, Array.from(selected), false)
      await complete()
      fireSuggestionPoolWarmup()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Save failed.')
    } finally {
      setSubmitting(false)
      setLeaveOpen(false)
    }
  }

  const discardAndLeave = () => {
    setLeaveOpen(false)
    navigate('/onboarding/bridge', { replace: true })
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2 max-w-lg mx-auto w-full">
        <button
          type="button"
          onClick={() => {
            if (!isDirty) {
              navigate('/onboarding/bridge', { replace: true })
              return
            }
            setLeaveOpen(true)
          }}
          className="text-sm text-sage-light hover:text-cream"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-sm text-sage-light hover:text-terra-light disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>

      <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col pb-28">
        <ColdStartProgressBar highlightStep={2} step3Unlocked={justUnlocked} />

        <h1 className="text-heading text-cream text-center mb-2">
          What&apos;s already in your kitchen?
        </h1>
        <p className="text-sage-light text-center text-sm leading-relaxed mb-6">
          We pre-filled the staples most kitchens have. Remove anything you don&apos;t, tap
          anything we missed.
        </p>

        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          className="flex items-center justify-center gap-2 mb-4 text-sage-light text-xs w-full py-2 rounded-mise-md hover:bg-forest-light/60 hover:text-cream transition-colors"
        >
          <Mic className="w-4 h-4" aria-hidden />
          Or just tell us what you have
        </button>

        {error && (
          <div className="mb-4 rounded-mise-md border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error)] bg-[var(--color-error)]/10">
            <p>{error}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs px-3 py-1.5 rounded-mise-md bg-forest-light border border-sage/30 text-cream hover:border-terra/40"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await signOut()
                    navigate('/auth', { replace: true })
                  } catch (e) {
                    setError(e.message || 'Sign out failed.')
                  }
                }}
                className="text-xs px-3 py-1.5 rounded-mise-md bg-transparent border border-sage/40 text-sage-light hover:text-cream"
              >
                Sign out and back in
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
          </div>
        ) : (
          categories.map((cat) => (
            <CategorySection
              key={cat.name}
              name={cat.name}
              items={cat.items}
              selectedSet={selected}
              preSelectedSet={preSelectedDefaults}
              receiptMatches={receiptMatches}
              onToggle={toggle}
            />
          ))
        )}

        <button
          type="button"
          onClick={() => {
            loadPantryBases()
            setSearchOpen(true)
          }}
          className="text-center text-sm text-sage-light hover:text-terra-light mb-6 underline underline-offset-2 w-full"
        >
          Missing something? Add it to your pantry →
        </button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-forest via-forest to-transparent pt-10">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            disabled={submitting || loading || selected.size === 0}
            onClick={() => handleConfirm({ skip: false })}
            className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Done — show me what\'s for dinner'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-24 left-4 right-4 max-w-lg mx-auto z-50"
          >
            <div className="rounded-mise-md bg-forest-light border border-sage/30 text-cream text-sm px-4 py-3 text-center shadow-lg">
              {toast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {leaveOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-title"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full max-w-sm rounded-mise-lg bg-forest-mid border border-sage/30 p-5"
            >
              <h2 id="leave-title" className="text-cream font-display font-semibold mb-2">
                Save what you&apos;ve selected so far?
              </h2>
              <p className="text-sage-light text-sm mb-4">
                You can keep your picks and finish setup later from settings.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={savePartialAndLeave}
                  disabled={submitting}
                  className="btn btn-primary w-full"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={discardAndLeave}
                  className="w-full text-sm text-sage-light py-2"
                >
                  Discard
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PantrySearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        userId={userId}
        excludeBases={searchExcludeBases}
        onAdded={() => loadPantryBases()}
        onOpenVoice={() => setVoiceOpen(true)}
      />

      <VoiceInputSheet
        isOpen={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        userId={userId}
        excludeBases={searchExcludeBases}
        onAfterBatchSuccess={async () => {
          if (!userId) return
          const list = Array.from(selected)
          const result = await api.confirmStaples(userId, list, false)
          await complete()
          fireSuggestionPoolWarmup()
          setJustUnlocked(true)
          const n = result.receipt_matched ?? 0
          if (n > 0) {
            setToast(`We matched ${n} of your staples to your recent receipts ✓`)
            setTimeout(() => setToast(null), 4500)
          }
          setTimeout(
            () => {
              navigate('/', { replace: true })
            },
            n > 0 ? 600 : 0
          )
        }}
      />
    </div>
  )
}
