import { useCallback } from 'react'
import { motion, useMotionValue } from 'framer-motion'
import SuggestionRecipeCard from './SuggestionRecipeCard'
import { suggestionCardKey } from '../utils/dinnerPickerRank'

const SWIPE_THRESHOLD = 80

function CookPickerDeck({
  visible = [],
  index = 0,
  onIndexChange,
  onDismiss,
  onDetails,
  dismissBusyKeys = new Set(),
  onHorizontalDragChange,
}) {
  const x = useMotionValue(0)

  const safeIndex = Math.min(Math.max(0, index), Math.max(0, visible.length - 1))
  const current = visible[safeIndex]
  const next = visible[safeIndex + 1]
  const total = visible.length

  const goTo = useCallback(
    (nextIndex) => {
      if (nextIndex < 0 || nextIndex >= visible.length) return
      onIndexChange?.(nextIndex)
    },
    [onIndexChange, visible.length]
  )

  const handleDragStart = () => {
    onHorizontalDragChange?.(true)
  }

  const handleDragEnd = (_e, info) => {
    onHorizontalDragChange?.(false)
    if (info.offset.x < -SWIPE_THRESHOLD) {
      goTo(safeIndex + 1)
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      goTo(safeIndex - 1)
    }
    x.set(0)
  }

  if (!current) {
    return null
  }

  const currentKey = suggestionCardKey(current)

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-lg mx-auto">
      <p className="text-center text-xs text-sage-light mb-2" aria-live="polite">
        {safeIndex + 1} / {total}
      </p>

      <div className="relative flex-1 min-h-[280px] sm:min-h-[360px]">
        {next ? (
          <div
            className="absolute inset-y-0 right-0 w-[14%] overflow-hidden rounded-meald-lg pointer-events-none z-0"
            aria-hidden
          >
            <div
              className="absolute top-0 right-0 h-full w-[700%] origin-right scale-[0.92] opacity-70"
              style={{ transform: 'scale(0.92)' }}
            >
              <SuggestionRecipeCard
                recipe={next}
                tier={next.tier}
                variant="peek"
              />
            </div>
          </div>
        ) : null}

        <motion.div
          className="relative z-10 h-full"
          style={{ x }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SuggestionRecipeCard
            recipe={current}
            tier={current.tier}
            variant="picker"
            fillHeight
            onDismiss={onDismiss}
            onExpand={onDetails}
            dismissBusy={dismissBusyKeys.has(currentKey)}
          />
        </motion.div>
      </div>

      <div className="flex justify-center gap-4 mt-3 pb-2">
        <button
          type="button"
          className="btn btn-secondary text-sm py-2 px-4 disabled:opacity-40"
          disabled={safeIndex <= 0}
          onClick={() => goTo(safeIndex - 1)}
          aria-label="Previous suggestion"
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary text-sm py-2 px-4 disabled:opacity-40"
          disabled={safeIndex >= total - 1}
          onClick={() => goTo(safeIndex + 1)}
          aria-label="Next suggestion"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default CookPickerDeck
