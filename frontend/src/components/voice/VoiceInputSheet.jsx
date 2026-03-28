import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Mic, X } from 'lucide-react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import VoiceWaveform from './VoiceWaveform'
import IngredientSearchInput from '../IngredientSearchInput'
import { api } from '../../services/apiClient'

async function successHaptic() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* ignore */
  }
}

/**
 * Layer 3: record → transcribe → review chips → batch confirm.
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {string} userId
 * @param {string[]} excludeBases - pantry bases to exclude from mini-search
 * @param {() => void} [onPantryRefresh] - after confirm (non-onboarding)
 * @param {(r: { added: number, already_existed: number }) => Promise<void>} [onAfterBatchSuccess] - e.g. onboarding completes arc
 */
export default function VoiceInputSheet({
  isOpen,
  onClose,
  userId,
  excludeBases = [],
  onPantryRefresh,
  onAfterBatchSuccess,
}) {
  const [step, setStep] = useState('recording') // recording | processing | review
  const [confirmed, setConfirmed] = useState([])
  const [removedBases, setRemovedBases] = useState(() => new Set())
  const [uncertain, setUncertain] = useState([])
  const [transcript, setTranscript] = useState('')
  const [recoverHint, setRecoverHint] = useState(null)
  const [showMiniSearch, setShowMiniSearch] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [dupNote, setDupNote] = useState(null)
  const [showSlowHint, setShowSlowHint] = useState(false)

  const uploadStartedRef = useRef(false)
  const slowTimerRef = useRef(null)

  const {
    status,
    audioBlob,
    error: recError,
    durationSec,
    startRecording,
    stopRecording,
    resetRecording,
    getAnalyser,
  } = useVoiceRecorder()

  const [analyser, setAnalyser] = useState(null)

  useEffect(() => {
    if (!isOpen || status !== 'recording') {
      setAnalyser(null)
      return undefined
    }
    const id = setInterval(() => {
      const a = getAnalyser()
      if (a) setAnalyser(a)
    }, 90)
    return () => clearInterval(id)
  }, [isOpen, status, getAnalyser])

  const resetAll = useCallback(() => {
    uploadStartedRef.current = false
    resetRecording()
    setStep('recording')
    setConfirmed([])
    setRemovedBases(new Set())
    setUncertain([])
    setTranscript('')
    setRecoverHint(null)
    setShowMiniSearch(false)
    setSubmitting(false)
    setDupNote(null)
    setShowSlowHint(false)
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current)
      slowTimerRef.current = null
    }
  }, [resetRecording])

  useEffect(() => {
    if (!isOpen) {
      resetAll()
      return undefined
    }
    resetAll()
    const t = setTimeout(() => {
      startRecording()
    }, 150)
    return () => clearTimeout(t)
    // Only re-run when sheet opens/closes — not when recorder fn identity changes mid-session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const searchExcludeBases = useMemo(() => {
    const s = new Set(
      (excludeBases || []).map((b) => String(b).toLowerCase())
    )
    for (const c of confirmed) {
      if (c.base_ingredient) s.add(String(c.base_ingredient).toLowerCase())
    }
    return [...s]
  }, [excludeBases, confirmed])

  const visibleConfirmed = useMemo(
    () => confirmed.filter((c) => !removedBases.has(c.base_ingredient)),
    [confirmed, removedBases]
  )

  const effectiveCount = visibleConfirmed.length

  useEffect(() => {
    if (
      !isOpen ||
      step !== 'recording' ||
      status !== 'stopped' ||
      !audioBlob ||
      uploadStartedRef.current
    ) {
      return
    }
    uploadStartedRef.current = true
    setStep('processing')
    setShowSlowHint(false)
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current)
    slowTimerRef.current = setTimeout(() => setShowSlowHint(true), 1500)

    let cancelled = false
    ;(async () => {
      try {
        const data = await api.voiceTranscribe(audioBlob)
        if (cancelled) return
        setConfirmed(data.confirmed || [])
        setRemovedBases(new Set())
        setUncertain(data.uncertain || [])
        setTranscript(data.transcript || '')
        setStep('review')
      } catch (e) {
        if (cancelled) return
        console.error(e)
        uploadStartedRef.current = false
        setRecoverHint(
          e.response?.data?.message ||
            'We had trouble hearing that — try again, or type instead.'
        )
        setStep('recording')
        resetRecording()
      } finally {
        if (slowTimerRef.current) {
          clearTimeout(slowTimerRef.current)
          slowTimerRef.current = null
        }
        setShowSlowHint(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // step is managed by this effect; including it would cancel the in-flight
    // API call when setStep('processing') re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- step omitted intentionally
  }, [isOpen, status, audioBlob, resetRecording])

  const handleClose = () => {
    resetAll()
    onClose?.()
  }

  const handleStop = () => {
    stopRecording()
  }

  const toggleRemoveChip = (base) => {
    setRemovedBases((prev) => {
      const next = new Set(prev)
      if (next.has(base)) next.delete(base)
      else next.add(base)
      return next
    })
  }

  const acceptUncertain = (row) => {
    if (row.base_ingredient) {
      setConfirmed((prev) => {
        const b = row.base_ingredient
        if (prev.some((p) => p.base_ingredient === b)) return prev
        return [
          ...prev,
          {
            base_ingredient: b,
            display_name: row.suggestion || b,
          },
        ]
      })
    }
    setUncertain((u) => u.filter((x) => x !== row))
  }

  const rejectUncertain = (row) => {
    setUncertain((u) => u.filter((x) => x !== row))
  }

  const handleStartOver = () => {
    uploadStartedRef.current = false
    resetRecording()
    setConfirmed([])
    setRemovedBases(new Set())
    setUncertain([])
    setTranscript('')
    setRecoverHint(null)
    setStep('recording')
    setDupNote(null)
    setTimeout(() => startRecording(), 150)
  }

  const handleAddAll = async () => {
    if (!userId || effectiveCount === 0) return
    setSubmitting(true)
    setDupNote(null)
    try {
      const bases = visibleConfirmed.map((c) => c.base_ingredient)
      const result = await api.voiceConfirm(userId, bases)
      await successHaptic()
      const ae = result.already_existed ?? 0
      if (onAfterBatchSuccess) {
        await onAfterBatchSuccess({
          added: result.added ?? 0,
          already_existed: ae,
        })
      } else {
        if (ae > 0) {
          setDupNote(`${ae} item${ae === 1 ? '' : 's'} were already in your pantry`)
        }
        onPantryRefresh?.()
      }
      handleClose()
    } catch (e) {
      console.error(e)
      setDupNote(e.response?.data?.error || 'Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[80] flex flex-col bg-forest"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-sage/20 shrink-0">
            <div className="flex items-center gap-2 text-cream">
              <Mic className="w-5 h-5 text-terra" aria-hidden />
              <span className="font-display font-semibold">Voice</span>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-mise-md text-sage-light hover:text-cream hover:bg-forest-light"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full">
            {step === 'recording' && (
              <div className="flex flex-col items-center text-center">
                <p className="text-cream font-display text-lg mb-2">
                  Tell us what you have — just say it naturally
                </p>
                <p className="text-sage-light text-sm mb-6 leading-relaxed">
                  e.g. pasta, olive oil, chicken thighs, canned tomatoes, some hot sauce…
                </p>

                <VoiceWaveform analyser={analyser} isActive={status === 'recording'} />

                {status === 'recording' && (
                  <p className="text-sage-light text-xs mt-4 tabular-nums">
                    {Math.floor(durationSec / 60)}:
                    {String(durationSec % 60).padStart(2, '0')}
                  </p>
                )}

                {(recError || recoverHint) && (
                  <p className="text-[var(--color-error)] text-sm mt-4 max-w-sm">
                    {recError || recoverHint}
                  </p>
                )}

                <div className="mt-10 w-full space-y-3">
                  <button
                    type="button"
                    disabled={status !== 'recording'}
                    onClick={handleStop}
                    className="w-full btn btn-primary disabled:opacity-40"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full text-sm text-sage-light hover:text-cream py-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {step === 'processing' && (
              <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
                <p className="text-cream">
                  {showSlowHint ? 'Reading your pantry…' : 'Hang tight…'}
                </p>
              </div>
            )}

            {step === 'review' && (
              <div className="pb-8">
                <h2 className="text-cream font-display text-lg mb-1">
                  We heard {effectiveCount} item{effectiveCount === 1 ? '' : 's'} — does this look
                  right?
                </h2>
                {transcript ? (
                  <p className="text-sage-light text-xs mb-4 line-clamp-2">&ldquo;{transcript}&rdquo;</p>
                ) : null}

                <div className="flex flex-wrap gap-2 mb-6">
                  {visibleConfirmed.map((c) => (
                    <button
                      key={c.base_ingredient}
                      type="button"
                      onClick={() => toggleRemoveChip(c.base_ingredient)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-forest-light border border-sage/30 text-cream text-sm"
                    >
                      {c.display_name}
                      <span className="text-sage-light" aria-hidden>
                        ×
                      </span>
                    </button>
                  ))}
                </div>

                {uncertain.length > 0 && (
                  <div className="mb-6 rounded-mise-md border border-sage/25 bg-forest-mid/50 p-3">
                    <p className="text-sage-light text-sm font-medium mb-3">
                      We weren&apos;t sure about these — do you mean…?
                    </p>
                    <ul className="space-y-3">
                      {uncertain.map((u, idx) => (
                        <li
                          key={`${u.heard}-${idx}`}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-cream"
                        >
                          <span className="flex-1">
                            <span className="text-sage-light">{u.heard}</span>
                            {u.suggestion ? (
                              <>
                                {' → '}
                                <span className="text-cream">{u.suggestion}</span>
                              </>
                            ) : null}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!u.base_ingredient}
                              onClick={() => acceptUncertain(u)}
                              className="px-3 py-1 rounded-mise-md bg-terra text-white text-xs disabled:opacity-40"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => rejectUncertain(u)}
                              className="px-3 py-1 rounded-mise-md border border-sage/40 text-sage-light text-xs"
                            >
                              No
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowMiniSearch((s) => !s)}
                  className="text-sm text-terra-light hover:underline mb-4"
                >
                  {showMiniSearch ? 'Hide' : 'Add something'}
                </button>

                {showMiniSearch && userId && (
                  <div className="mb-6">
                    <IngredientSearchInput
                      userId={userId}
                      excludeBases={searchExcludeBases}
                      autoFocus
                      onAdded={(out) => {
                        const base = out?.item?.base_ingredient
                        const disp = out?.item?.display_name || base
                        if (base) {
                          setConfirmed((prev) => {
                            if (prev.some((p) => p.base_ingredient === base)) return prev
                            return [...prev, { base_ingredient: base, display_name: disp }]
                          })
                          setRemovedBases((prev) => {
                            const next = new Set(prev)
                            next.delete(base)
                            return next
                          })
                        }
                      }}
                    />
                  </div>
                )}

                {dupNote && (
                  <p className="text-sage-light text-xs mb-3" role="status">
                    {dupNote}
                  </p>
                )}

                <button
                  type="button"
                  disabled={submitting || effectiveCount === 0}
                  onClick={handleAddAll}
                  className="w-full btn btn-primary disabled:opacity-50 mb-3"
                >
                  {submitting
                    ? 'Saving…'
                    : `Add all to my pantry (${effectiveCount})`}
                </button>
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="w-full text-sm text-sage-light py-2"
                >
                  Start over
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
