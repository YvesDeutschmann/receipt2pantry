import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useOnboarding } from '../../contexts/OnboardingContext'
import { api } from '../../services/apiClient'
import { supabase } from '../../services/supabaseClient'

function BridgeScreen() {
  const navigate = useNavigate()
  const { user, session } = useAuth()
  const { householdSize, dietaryRestrictions } = useOnboarding()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const getSignupMethod = () => {
    const provider = session?.provider ?? user?.app_metadata?.provider ?? user?.identities?.[0]?.provider
    if (provider === 'apple') return 'apple'
    if (provider === 'google') return 'google'
    return 'email'
  }

  const completeOnboarding = async (navigateTo) => {
    setError(null)
    setLoading(true)
    try {
      await api.updateHouseholdProfile(user.id, {
        size: householdSize,
        dietaryRestrictions,
      })

      await supabase.auth.updateUser({
        data: {
          onboarding_completed_at: new Date().toISOString(),
          signup_method: getSignupMethod(),
        },
      })

      navigate(navigateTo, { replace: true })
    } catch (err) {
      setError(err.message || 'Something went wrong. Tap to try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-6">
          Now let&apos;s stock your pantry.
        </h1>
        <p className="text-sage-light text-center mb-8 leading-relaxed">
          We&apos;ll connect to your grocery store to see what you&apos;ve been buying.
          It takes about a minute and you&apos;ll come right back. Your first recipe
          suggestions will be ready after that.
        </p>

        {error && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => completeOnboarding('/providers')}
            onKeyDown={(e) => e.key === 'Enter' && completeOnboarding('/providers')}
            className="rounded-mise-md border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error)] bg-[var(--color-error)]/10 mb-6 cursor-pointer"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => completeOnboarding('/providers')}
          disabled={loading}
          className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-cream border-t-transparent" />
              Connecting...
            </span>
          ) : (
            'Connect my grocery store'
          )}
        </button>

        <button
          type="button"
          onClick={() => completeOnboarding('/pantry')}
          disabled={loading}
          className="w-full text-sm text-sage-light hover:text-terra-light transition-colors py-2"
        >
          I&apos;ll add items manually
        </button>
      </div>
    </div>
  )
}

export default BridgeScreen
