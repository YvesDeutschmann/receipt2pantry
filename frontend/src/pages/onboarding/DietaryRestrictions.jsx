import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'
import OnboardingPayoffPanel from '../../components/onboarding/OnboardingPayoffPanel'
import DietaryRestrictionChips from '../../components/onboarding/DietaryRestrictionChips'

function DietaryRestrictions() {
  const navigate = useNavigate()
  const {
    rawDietaryRestrictions,
    noRestrictions,
    toggleRestriction,
    setRestrictionsAffirmativeNone,
    otherRestriction,
    setOtherRestriction,
    householdId,
    householdResolved,
    householdLoading,
    isJoiner,
    mergeJoinDietary,
    completeJoin,
  } = useOnboarding()

  const [showPayoff, setShowPayoff] = useState(false)
  const [payoffError, setPayoffError] = useState(null)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [showOtherInput, setShowOtherInput] = useState(false)
  const [inlineError, setInlineError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  useEffect(() => {
    if (householdResolved && !householdLoading && !householdId) {
      navigate('/onboarding', { replace: true })
    }
  }, [householdResolved, householdLoading, householdId, navigate])

  const canAdvance = noRestrictions || rawDietaryRestrictions.length > 0
  const ctaEnabled = hasInteracted && canAdvance

  const handleChipClick = (code) => {
    setHasInteracted(true)
    setInlineError(false)
    if (code === 'other') {
      setShowOtherInput((prev) => !prev)
    } else {
      toggleRestriction(code)
    }
  }

  const handleNoRestrictionsClick = () => {
    setHasInteracted(true)
    setInlineError(false)
    setRestrictionsAffirmativeNone()
    setShowOtherInput(false)
  }

  const handleOtherTextChange = (text) => {
    setHasInteracted(true)
    setInlineError(false)
    setOtherRestriction(text)
  }

  const handleNext = async () => {
    if (!ctaEnabled || submitting) {
      if (!ctaEnabled) setInlineError(true)
      return
    }

    if (isJoiner) {
      setSubmitting(true)
      setSubmitError(null)
      try {
        await mergeJoinDietary()
        setShowPayoff(true)
      } catch (err) {
        setSubmitError(err.message || 'Failed to save dietary restrictions')
      } finally {
        setSubmitting(false)
      }
      return
    }

    navigate('/onboarding/bridge')
  }

  if (householdLoading || !householdResolved) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
      </div>
    )
  }

  if (!householdId) {
    return null
  }

  const handlePayoffTap = async () => {
    setSubmitting(true)
    setPayoffError(null)
    try {
      await completeJoin()
    } catch (err) {
      setPayoffError(err.message || 'Could not finish setup. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isJoiner && showPayoff) {
    return (
      <div className="min-h-screen bg-forest flex flex-col">
        <OnboardingPayoffPanel
          variant="joiner"
          onComplete={handlePayoffTap}
          submitting={submitting}
          error={payoffError}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-2">
          Any allergies or intolerances we should know about?
        </h1>
        <p className="text-sm text-sage-light text-center mb-8">
          {isJoiner
            ? 'Your household already has restrictions listed. Add any of your own below.'
            : 'This covers your whole household. You can update this any time in settings.'}
        </p>

        <DietaryRestrictionChips
          selectedCodes={rawDietaryRestrictions}
          otherRestriction={otherRestriction}
          noRestrictions={noRestrictions}
          showOtherInput={showOtherInput}
          onChipClick={handleChipClick}
          onNoRestrictionsClick={handleNoRestrictionsClick}
          onOtherTextChange={handleOtherTextChange}
        />

        {inlineError && (
          <p className="text-sm text-[var(--color-error)] mb-4">
            Please confirm your household&apos;s restrictions, or tap &apos;No dietary restrictions&apos; to continue.
          </p>
        )}

        {submitError && (
          <p className="text-sm text-[var(--color-error)] mb-4">{submitError}</p>
        )}

        <button
          type="button"
          onClick={handleNext}
          disabled={!ctaEnabled || submitting}
          className={`w-full btn btn-primary ${!ctaEnabled || submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {submitting ? 'Saving...' : isJoiner ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  )
}

export default DietaryRestrictions
