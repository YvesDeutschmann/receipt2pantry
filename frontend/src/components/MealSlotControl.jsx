const SLOT_ORDER = ['breakfast', 'lunch', 'dinner']

const SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

function MealSlotControl({ selectedSlot, enabledSlots, onChange }) {
  const visibleSlots = SLOT_ORDER.filter((slot) => enabledSlots?.[slot] !== false)
  if (visibleSlots.length <= 1) return null

  return (
    <div
      role="tablist"
      aria-label="Meal slot"
      className="inline-flex rounded-meald-md border border-sage/30 bg-forest-mid p-0.5 gap-0.5"
    >
      {visibleSlots.map((slot) => {
        const selected = slot === selectedSlot
        return (
          <button
            key={slot}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`btn text-sm py-1.5 px-3 rounded-meald-sm ${
              selected ? 'btn-primary' : 'btn-ghost'
            }`}
            onClick={() => {
              if (!selected) onChange(slot)
            }}
          >
            {SLOT_LABELS[slot]}
          </button>
        )
      })}
    </div>
  )
}

export default MealSlotControl
