import { motion } from 'framer-motion'
import { Capacitor } from '@capacitor/core'

const pageVariants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: 'easeOut',
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.15,
      ease: 'easeIn',
    },
  },
}

// framer-motion v11 uses WAAPI for opacity/transform animations.
// In Capacitor's WKWebView on iOS the initial WAAPI frame can silently
// drop, leaving the element permanently at opacity:0.  Skip the enter/exit
// fade on native; the tab-switch still feels snappy without it.
const isNative = Capacitor.isNativePlatform()

function PageTransition({ children }) {
  if (isNative) {
    return <div className="min-h-0">{children}</div>
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-0"
    >
      {children}
    </motion.div>
  )
}

export default PageTransition
