import { Capacitor } from '@capacitor/core'
import { openLegalPage } from '../utils/openLegalPage'

/**
 * Link to a compile-time legal URL. Native: system browser via App.openUrl.
 */
export default function LegalLink({ url, children, className = '' }) {
  const isNative = Capacitor.isNativePlatform()

  if (isNative) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          void openLegalPage(url)
        }}
        className={`underline hover:text-cream bg-transparent border-0 p-0 font-inherit text-inherit cursor-pointer ${className}`.trim()}
      >
        {children}
      </button>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline hover:text-cream ${className}`.trim()}
    >
      {children}
    </a>
  )
}
