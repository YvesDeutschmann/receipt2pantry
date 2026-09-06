import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'

const GENERIC_ERROR = 'Something went wrong. Please try again.'

function BridgeScreen() {
  const navigate = useNavigate()
  const { completeBridge } = useOnboarding()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inFlightRef = useRef(false)

  const clearInFlight = () => {
    inFlightRef.current = false
    setLoading(false)
  }

  const proceedFromBridge = async (navigateTo, coldStartMeta) => {
    if (inFlightRef.current) return

    inFlightRef.current = true
    setError(null)
    setLoading(true)

    try {
      const ok = await completeBridge(coldStartMeta)
      if (!ok) {
        setError(GENERIC_ERROR)
        clearInFlight()
        return
      }

      navigate(navigateTo, { replace: true })
    } catch {
      setError(GENERIC_ERROR)
      clearInFlight()
    }
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-6">
          Now let&apos;s stock your pantry.
        </h1>
        <p className="text-sage-light text-center mb-8 leading-relaxed">
          Connect a store to fill your pantry from recent receipts, or add items yourself.
          You&apos;ll get dinner suggestions either way.
        </p>

        {error && (
          <div
            role="alert"
            className="rounded-mise-md border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error)] bg-[var(--color-error)]/10 mb-6"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() =>
            proceedFromBridge('/providers', {
              cold_start_skip_grocery: false,
              bridge_chose_providers: true,
            })
          }
          disabled={loading}
          className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-cream border-t-transparent" />
              Working…
            </span>
          ) : (
            'Connect my grocery store'
          )}
        </button>

        <button
          type="button"
          onClick={() =>
            proceedFromBridge('/onboarding/pantry-setup', {
              cold_start_skip_grocery: true,
              bridge_chose_manual: true,
              cold_start_grocery_connected: true,
            })
          }
          disabled={loading}
          className="w-full btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          I&apos;ll add items manually
        </button>
      </div>
    </div>
  )
}

export default BridgeScreen
