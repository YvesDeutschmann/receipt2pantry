import { useState } from 'react'

export function getSizeLabel(n) {
  if (n === 1) return 'Cooking for yourself'
  if (n === 2) return 'Cooking for 2'
  if (n >= 3 && n <= 9) return `Cooking for ${n}`
  return 'Cooking for 10+'
}

/**
 * Controlled household size stepper (1–10 via +/-, 11–99 manual).
 * @param {{ size: number, onSizeChange: (n: number) => void, compact?: boolean }} props
 */
export default function HouseholdSizePicker({ size, onSizeChange, compact = false }) {
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualValue, setManualValue] = useState('')

  const clamped = Math.max(1, Math.min(99, size))
  const atMin = clamped <= 1
  const atMax = clamped >= 10

  const handleDecrement = () => {
    if (!atMin) onSizeChange(clamped - 1)
  }

  const handleIncrement = () => {
    if (atMax) {
      setShowManualInput(true)
      setManualValue(String(clamped))
    } else {
      onSizeChange(clamped + 1)
    }
  }

  const handleManualSubmit = () => {
    const parsed = parseInt(manualValue, 10)
    if (!isNaN(parsed) && parsed >= 11 && parsed <= 99) {
      onSizeChange(parsed)
      setShowManualInput(false)
      setManualValue('')
    }
  }

  const numberClass = compact
    ? 'text-4xl font-display font-bold text-cream tabular-nums'
    : 'text-5xl font-display font-bold text-cream tabular-nums'

  return (
    <div className={compact ? 'w-full' : 'flex flex-col items-center w-full'}>
      <div className="flex items-center justify-center gap-6 w-full mb-6">
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
          <span className={numberClass} style={compact ? undefined : { fontSize: '48px' }}>
            {clamped}
          </span>
          <span className="text-base text-sage-light mt-2 text-center">
            {getSizeLabel(clamped)}
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
        <div className="w-full mb-4 flex gap-2">
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
          <button type="button" onClick={handleManualSubmit} className="btn btn-primary">
            Set
          </button>
        </div>
      )}
    </div>
  )
}
