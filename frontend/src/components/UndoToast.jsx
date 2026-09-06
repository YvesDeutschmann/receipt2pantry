import { useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const DEFAULT_MS = 4000

/**
 * Bottom snackbar with optional Undo (master brief: 4s dismiss).
 */
export default function UndoToast({
  open,
  message,
  actionLabel = 'Undo',
  onAction,
  onDismiss,
  durationMs = DEFAULT_MS,
}) {
  const timerRef = useRef(null)
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    clearTimer()
    if (!open) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onDismiss?.()
    }, durationMs)
    return clearTimer
  }, [open, durationMs, onDismiss, clearTimer])

  const handleAction = () => {
    clearTimer()
    onAction?.()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 left-4 right-4 z-[100] max-w-lg mx-auto pointer-events-auto"
        >
          <div className="flex items-center justify-between gap-3 rounded-meald-md bg-forest-mid border border-sage/30 px-4 py-3 shadow-meald-lg text-sm text-cream">
            <span className="flex-1 min-w-0">{message}</span>
            {onAction && (
              <button
                type="button"
                onClick={handleAction}
                className="shrink-0 font-semibold text-terra hover:text-terra-light underline-offset-2"
              >
                {actionLabel}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
