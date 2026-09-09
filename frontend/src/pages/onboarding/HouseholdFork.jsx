import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'

function HouseholdFork() {
  const navigate = useNavigate()
  const {
    householdId,
    householdRole,
    householdResolved,
    householdLoading,
    householdError,
    createHouseholdExplicit,
  } = useOnboarding()

  const [submitting, setSubmitting] = useState(false)
  const [forkError, setForkError] = useState(null)

  useEffect(() => {
    if (!householdResolved || householdLoading) return
    if (!householdId) return
    if (householdRole === 'member') {
      navigate('/onboarding/dietary', { replace: true })
    } else {
      navigate('/onboarding/size', { replace: true })
    }
  }, [householdResolved, householdLoading, householdId, householdRole, navigate])

  const handleCreate = async () => {
    if (submitting) return
    setSubmitting(true)
    setForkError(null)
    try {
      await createHouseholdExplicit()
      navigate('/onboarding/size')
    } catch (err) {
      setForkError(err.response?.data?.error || err.message || 'Failed to create household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleNoCode = async () => {
    if (submitting) return
    setSubmitting(true)
    setForkError(null)
    try {
      await createHouseholdExplicit()
      navigate('/onboarding/size')
    } catch (err) {
      setForkError(err.response?.data?.error || err.message || 'Failed to create household')
    } finally {
      setSubmitting(false)
    }
  }

  if (householdLoading || !householdResolved) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
        <p className="mt-4 text-sage-light">Loading...</p>
      </div>
    )
  }

  if (householdError) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <p className="text-[var(--color-error)]">{householdError}</p>
      </div>
    )
  }

  if (householdId) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-4">
          Set up your household
        </h1>
        <p className="text-sm text-sage-light text-center mb-10">
          Share a pantry with family, or start fresh on your own.
        </p>

        {forkError && (
          <p className="text-sm text-[var(--color-error)] text-center mb-4">{forkError}</p>
        )}

        <button
          type="button"
          onClick={() => navigate('/onboarding/join')}
          disabled={submitting}
          className="w-full btn btn-primary mb-4 disabled:opacity-50"
        >
          I have a join code
        </button>

        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting}
          className="w-full btn btn-secondary mb-4 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create my household'}
        </button>

        <button
          type="button"
          onClick={handleNoCode}
          disabled={submitting}
          className="w-full py-3 text-sm text-sage-light hover:text-cream transition-colors disabled:opacity-50"
        >
          I don&apos;t have a code
        </button>
      </div>
    </div>
  )
}

export default HouseholdFork
