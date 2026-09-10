import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { X } from 'lucide-react'

const MOBILE_BREAKPOINT = '(max-width: 1023px)'

export const APP_OVERLAY_Z_CLASS = 'z-[70]'

function AdaptiveModal({ isOpen, onClose, title, children, hideHeader, footer }) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT)

  useEffect(() => {
    if (!isOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const headerRow = (title || onClose) && (
    <div className="flex items-center justify-between px-4 pb-3 border-b border-forest-light sm:px-6 sm:pt-5 sm:pb-4">
      {title && (
        <h3 id="modal-title" className="text-lg font-display font-semibold text-cream">
          {title}
        </h3>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-2 -m-2 text-sage-light hover:text-cream min-w-touch min-h-touch flex items-center justify-center"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>
      )}
    </div>
  )

  let modalContent

  if (isMobile) {
    modalContent = (
      <AnimatePresence>
        <div
          className={`fixed inset-0 ${APP_OVERLAY_Z_CLASS} flex flex-col justify-end`}
          aria-modal="true"
          aria-labelledby="modal-title"
          data-testid="adaptive-modal-overlay"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-forest/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleBackdropClick}
          />

          {/* Bottom Sheet */}
          <motion.div
            className="relative bg-forest-mid rounded-t-2xl shadow-meald-lg overflow-hidden flex flex-col max-h-[85vh]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1 bg-forest-light rounded-full" />
            </div>

            {(title || onClose) && headerRow}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-testid="modal-scroll">
              {children}
            </div>
            {footer ? (
              <div
                className="shrink-0 bg-forest border-t border-forest-light pb-safe-bottom"
                data-testid="modal-footer"
              >
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      </AnimatePresence>
    )
  } else {
    // Desktop: centered modal
    modalContent = (
      <AnimatePresence>
        <div
          className={`fixed inset-0 ${APP_OVERLAY_Z_CLASS}`}
          aria-modal="true"
          aria-labelledby="modal-title"
          data-testid="adaptive-modal-overlay"
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-4">
            <motion.div
              className="fixed inset-0 bg-forest/75"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleBackdropClick}
            />
            <motion.div
              className="relative bg-forest-mid rounded-meald-lg shadow-meald-lg max-w-lg w-full mx-auto flex flex-col max-h-[calc(100vh-8rem)] overflow-hidden"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              {!hideHeader && (title || onClose) && headerRow}
              <div className="flex-1 min-h-0 overflow-y-auto" data-testid="modal-scroll">
                {children}
              </div>
              {footer ? (
                <div className="shrink-0 bg-forest border-t border-forest-light" data-testid="modal-footer">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </div>
        </div>
      </AnimatePresence>
    )
  }

  return createPortal(modalContent, document.body)
}

export default AdaptiveModal
