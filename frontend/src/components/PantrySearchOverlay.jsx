import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, X } from 'lucide-react'
import IngredientSearchInput from './IngredientSearchInput'

/**
 * Full-screen layer-2 add flow (keyboard-friendly).
 */
export default function PantrySearchOverlay({
  isOpen,
  onClose,
  userId,
  excludeBases = [],
  onAdded,
  onOpenVoice,
  title = 'Add to pantry',
}) {
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[70] flex flex-col bg-forest"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-sage/20 shrink-0">
            <h2 className="text-lg font-display font-semibold text-cream">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-mise-md text-sage-light hover:text-cream hover:bg-forest-light"
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4 max-w-lg mx-auto w-full">
            <IngredientSearchInput
              userId={userId}
              excludeBases={excludeBases}
              autoFocus
              onAdded={() => onAdded?.()}
              renderRight={
                typeof onOpenVoice === 'function'
                  ? () => (
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onOpenVoice()
                        }}
                        className="p-2.5 rounded-mise-md text-sage-light hover:text-cream hover:bg-forest-light shrink-0"
                        aria-label="Tell us what you have (voice)"
                      >
                        <Mic className="w-5 h-5" />
                      </button>
                    )
                  : undefined
              }
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
