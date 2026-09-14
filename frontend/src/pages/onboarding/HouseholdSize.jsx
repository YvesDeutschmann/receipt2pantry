import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'
import HouseholdSizePicker from '../../components/onboarding/HouseholdSizePicker'

function HouseholdSize() {
  const navigate = useNavigate()
  const {
    householdId,
    householdSize,
    setHouseholdSize,
    householdResolved,
    householdLoading,
    householdError,
  } = useOnboarding()

  useEffect(() => {
    if (householdResolved && !householdLoading && !householdId) {
      navigate('/onboarding', { replace: true })
    }
  }, [householdResolved, householdLoading, householdId, navigate])

  const handleNext = () => {
    navigate('/onboarding/dietary')
  }

  if (householdLoading || !householdResolved) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
        <p className="mt-4 text-sage-light">Setting up...</p>
      </div>
    )
  }

  if (householdError) {
    return (
      <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4">
        <p className="text-[var(--color-error)]">{householdError}</p>
        <p className="mt-2 text-sm text-sage-light">Please try again or contact support.</p>
      </div>
    )
  }

  if (!householdId) {
    return null
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-12">
          How many people are you feeding?
        </h1>

        <HouseholdSizePicker size={householdSize} onSizeChange={setHouseholdSize} />

        <button
          type="button"
          onClick={handleNext}
          className="w-full btn btn-primary mt-8"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default HouseholdSize
