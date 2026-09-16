export const RESTRICTION_CHIPS = [
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

const CHIP_LABELS = Object.fromEntries(
  RESTRICTION_CHIPS.map(({ code, label }) => [code, label])
)

/** Human-readable summary for settings row values. */
export function formatDietarySummary(codes) {
  if (!codes?.length) return 'None'
  return codes
    .map((code) => CHIP_LABELS[code] || code)
    .join(', ')
}

/**
 * Controlled dietary restriction chip grid.
 * @param {{
 *   selectedCodes: string[],
 *   otherRestriction: string,
 *   noRestrictions: boolean,
 *   lockedCodes?: string[],
 *   showNoRestrictionsButton?: boolean,
 *   showOtherInput: boolean,
 *   onChipClick: (code: string) => void,
 *   onNoRestrictionsClick: () => void,
 *   onOtherTextChange: (text: string) => void,
 * }} props
 */
export default function DietaryRestrictionChips({
  selectedCodes,
  otherRestriction,
  noRestrictions,
  lockedCodes = [],
  showNoRestrictionsButton = true,
  showOtherInput,
  onChipClick,
  onNoRestrictionsClick,
  onOtherTextChange,
}) {
  const locked = new Set(lockedCodes)

  const isSelected = (code) => {
    if (code === 'other') return otherRestriction.trim().length > 0 || selectedCodes.includes('other')
    return selectedCodes.includes(code)
  }

  const isLocked = (code) => locked.has(code)

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {RESTRICTION_CHIPS.map(({ code, label }) => {
          const selected = isSelected(code)
          const chipLocked = isLocked(code)
          return (
            <button
              key={code}
              type="button"
              onClick={() => {
                if (chipLocked && code !== 'other') return
                onChipClick(code)
              }}
              disabled={chipLocked && code !== 'other'}
              className={`min-h-touch rounded-meald-md px-4 py-3 text-left text-sm font-medium transition-colors ${
                selected
                  ? 'bg-terra/20 text-terra-light border-2 border-terra'
                  : 'bg-forest-light text-sage-light border-2 border-transparent hover:border-forest-mid'
              } ${chipLocked && code !== 'other' ? 'opacity-90 cursor-default' : ''}`}
            >
              {label}
              {chipLocked && code !== 'other' ? (
                <span className="block text-xs text-sage-light mt-0.5 font-normal">Household</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {showOtherInput && (
        <div className="mb-6">
          <input
            type="text"
            value={otherRestriction}
            onChange={(e) => onOtherTextChange(e.target.value)}
            placeholder="e.g. FODMAP, histamine intolerance"
            className="input"
            autoFocus
          />
        </div>
      )}

      {showNoRestrictionsButton && (
        <button
          type="button"
          onClick={onNoRestrictionsClick}
          className="w-full py-3 rounded-meald-md border-2 border-forest-light text-sage-light hover:border-sage hover:text-cream transition-colors text-sm font-medium mb-2"
        >
          No dietary restrictions
        </button>
      )}
    </div>
  )
}
