import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'

const RESTRICTION_CHIPS = [
  { code: 'tree_nuts', label: 'Tree nuts' },
  { code: 'peanuts', label: 'Peanuts' },
  { code: 'shellfish', label: 'Shellfish' },
  { code: 'fish', label: 'Fish' },
  { code: 'dairy', label: 'Dairy' },
  { code: 'eggs', label: 'Eggs' },
  { code: 'gluten', label: 'Gluten / Wheat' },
  { code: 'soy', label: 'Soy' },
  { code: 'sesame', label: 'Sesame' },
  { code: 'other', label: 'Something else →' },
]

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
    completeJoinDietary,
  } = useOnboarding()

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
        await completeJoinDietary()
        navigate('/')
      } catch (err) {
        setSubmitError(err.message || 'Failed to save dietary restrictions')
      } finally {
        setSubmitting(false)
      }
      return
    }

    navigate('/onboarding/bridge')
  }

  const isSelected = (code) => {
    if (code === 'other') return otherRestriction.trim().length > 0
    return rawDietaryRestrictions.includes(code)
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

        <div className="grid grid-cols-2 gap-3 mb-6">
          {RESTRICTION_CHIPS.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => handleChipClick(code)}
              className={`min-h-touch rounded-meald-md px-4 py-3 text-left text-sm font-medium transition-colors ${
                isSelected(code)
                  ? 'bg-terra/20 text-terra-light border-2 border-terra'
                  : 'bg-forest-light text-sage-light border-2 border-transparent hover:border-forest-mid'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {showOtherInput && (
          <div className="mb-6">
            <input
              type="text"
              value={otherRestriction}
              onChange={(e) => handleOtherTextChange(e.target.value)}
              placeholder="e.g. FODMAP, histamine intolerance"
              className="input"
              autoFocus
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleNoRestrictionsClick}
          className="w-full py-3 rounded-meald-md border-2 border-forest-light text-sage-light hover:border-sage hover:text-cream transition-colors text-sm font-medium mb-6"
        >
          No dietary restrictions
        </button>

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
