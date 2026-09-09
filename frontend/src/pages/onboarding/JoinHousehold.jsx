import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'

function JoinHousehold() {
  const navigate = useNavigate()
  const {
    householdResolved,
    householdLoading,
    joinHouseholdByCode,
    createHouseholdExplicit,
  } = useOnboarding()

  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleJoin = async (e) => {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6 || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await joinHouseholdByCode(code)
      navigate('/onboarding/dietary')
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to join household'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateInstead = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await createHouseholdExplicit()
      navigate('/onboarding/size')
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create household')
    } finally {
      setSubmitting(false)
    }
  }

  if (householdLoading || !householdResolved) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-2">
          Join a household
        </h1>
        <p className="text-sm text-sage-light text-center mb-8">
          Enter the 6-character code from your partner.
        </p>

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            value={joinCode}
            onChange={(e) =>
              setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
            }
            placeholder="ABC123"
            maxLength={6}
            className="input text-center text-lg tracking-widest uppercase"
            autoComplete="off"
            autoFocus
          />

          {error && (
            <p className="text-sm text-[var(--color-error)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={joinCode.trim().length !== 6 || submitting}
            className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Joining...' : 'Join household'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleCreateInstead}
          disabled={submitting}
          className="w-full mt-6 py-3 text-sm text-sage-light hover:text-cream transition-colors disabled:opacity-50"
        >
          Create my own household instead
        </button>

        <button
          type="button"
          onClick={() => navigate('/onboarding')}
          className="w-full mt-2 py-2 text-sm text-sage-light hover:text-cream transition-colors"
        >
          Back
        </button>
      </div>
    </div>
  )
}

export default JoinHousehold
