import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from '../../contexts/OnboardingContext'

function getSizeLabel(n) {
  if (n === 1) return 'Cooking for yourself'
  if (n === 2) return 'Cooking for 2'
  if (n >= 3 && n <= 9) return `Cooking for ${n}`
  return 'Cooking for 10+'
}

function HouseholdSize() {
  const navigate = useNavigate()
  const { householdSize, setHouseholdSize, householdReady, householdLoading, householdError } = useOnboarding()
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualValue, setManualValue] = useState('')

  const size = Math.max(1, Math.min(99, householdSize))
  const atMin = size <= 1
  const atMax = size >= 10

  const handleDecrement = () => {
    if (!atMin) setHouseholdSize(size - 1)
  }

  const handleIncrement = () => {
    if (atMax) {
      setShowManualInput(true)
      setManualValue(String(size))
    } else {
      setHouseholdSize(size + 1)
    }
  }

  const handleManualSubmit = () => {
    const parsed = parseInt(manualValue, 10)
    if (!isNaN(parsed) && parsed >= 11 && parsed <= 99) {
      setHouseholdSize(parsed)
      setShowManualInput(false)
      setManualValue('')
    }
  }

  const handleNext = () => {
    navigate('/onboarding/dietary')
  }

  if (householdLoading) {
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

  if (!householdReady) {
    return null
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col px-4 py-8">
      <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
        <h1 className="text-heading text-cream text-center mb-12">
          How many people are you feeding?
        </h1>

        <div className="flex items-center justify-center gap-6 w-full mb-8">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={atMin}
            className="min-h-touch min-w-touch rounded-full bg-forest-light text-cream flex items-center justify-center text-2xl font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-forest-mid transition-colors"
            aria-label="Decrease"
          >
            −
          </button>

          <div className="flex flex-col items-center min-w-[120px]">
            <span
              className="text-5xl font-display font-bold text-cream tabular-nums"
              style={{ fontSize: '48px' }}
            >
              {size}
            </span>
            <span className="text-base text-sage-light mt-2 text-center">
              {getSizeLabel(size)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleIncrement}
            className={`min-h-touch min-w-touch rounded-full flex items-center justify-center text-2xl font-medium transition-colors ${
              atMax
                ? 'bg-transparent border-2 border-forest-light text-sage-light hover:border-terra hover:text-terra'
                : 'bg-forest-light text-cream hover:bg-forest-mid'
            }`}
            aria-label="Increase"
          >
            +
          </button>
        </div>

        {showManualInput && (
          <div className="w-full mb-6 flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={11}
              max={99}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="11–99"
              className="input flex-1 text-center"
              autoFocus
            />
            <button
              type="button"
              onClick={handleManualSubmit}
              className="btn btn-primary"
            >
              Set
            </button>
          </div>
        )}

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
