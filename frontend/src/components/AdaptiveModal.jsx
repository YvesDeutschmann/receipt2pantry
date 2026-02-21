import { motion, AnimatePresence } from 'framer-motion'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { X } from 'lucide-react'

const MOBILE_BREAKPOINT = '(max-width: 1023px)'

function AdaptiveModal({ isOpen, onClose, title, children, hideHeader }) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT)

  if (!isOpen) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  if (isMobile) {
    return (
      <AnimatePresence>
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-gray-500/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleBackdropClick}
          />

          {/* Bottom Sheet */}
          <motion.div
            className="relative bg-white rounded-t-2xl shadow-xl overflow-hidden flex flex-col max-h-[85vh] pb-safe"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            {(title || onClose) && (
              <div className="flex items-center justify-between px-4 pb-3 border-b border-gray-200">
                {title && (
                  <h3 id="modal-title" className="text-lg font-semibold text-gray-900">
                    {title}
                  </h3>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 -m-2 text-gray-400 hover:text-gray-600 min-w-touch min-h-touch flex items-center justify-center"
                    aria-label="Close"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>
    )
  }

  // Desktop: centered modal
  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-4">
          <motion.div
            className="fixed inset-0 bg-gray-500/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdropClick}
          />
          <motion.div
            className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-auto"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            {!hideHeader && (title || onClose) && (
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-200">
                {title && (
                  <h3 id="modal-title" className="text-lg font-semibold text-gray-900">
                    {title}
                  </h3>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 -m-2 text-gray-400 hover:text-gray-600"
                    aria-label="Close"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>
            )}
            <div className="overflow-y-auto max-h-[calc(100vh-12rem)]">
              {children}
            </div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  )
}

export default AdaptiveModal
