import { useState } from 'react'
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion'

function useSoonIngredientLine(recipe, resolvedTier) {
  if (resolvedTier !== 'use_soon') return null
  const seen = new Set()
  const names = []
  for (const f of recipe.ingredient_flags || []) {
    if (!f.is_use_soon || !f.ingredient_name) continue
    const n = String(f.ingredient_name).trim()
    const k = n.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      names.push(n)
    }
  }
  if (names.length === 0) return null
  const display =
    names.length === 1
      ? names[0]
      : `${names.slice(0, 2).join(' & ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`
  return `Use your ${display} before it's gone`
}

function shouldShowUseSoonMeatDisclaimer(recipe, resolvedTier) {
  if (resolvedTier !== 'use_soon') return false
  return (recipe.ingredient_flags || []).some(
    (f) =>
      f.is_use_soon &&
      (f.sub_class === 'raw_meat' || f.sub_class === 'raw_fish') &&
      (f.put_back_count ?? 0) > 0
  )
}

function tierCardClass(tier) {
  switch (tier) {
    case 'use_soon':
      return 'border-2 border-amber-500/50 bg-forest-mid'
    case 'cook_tonight':
      return 'border-l-4 border-l-emerald-500 bg-forest-mid'
    case 'probably_have':
      return 'opacity-80 bg-forest-mid/90'
    case 'check_first':
      return 'bg-forest-mid'
    default:
      return 'bg-forest-mid'
  }
}

function SuggestionRecipeCard({
  recipe,
  tier,
  onCookedIt,
  onDismiss,
  onExpand,
}) {
  const resolvedTier = tier ?? recipe.tier
  const useSoonLine = useSoonIngredientLine(recipe, resolvedTier)
  const x = useMotionValue(0)
  const [behindOpacity, setBehindOpacity] = useState(0)
  useMotionValueEvent(x, 'change', (latest) => {
    const o = Math.min(1, Math.abs(latest) / 120)
    setBehindOpacity(o)
  })

  return (
    <div className="relative mb-4 overflow-hidden rounded-mise-lg">
      <div
        className="absolute inset-0 bg-red-600/90 flex items-center justify-end pr-6 pointer-events-none z-0 transition-opacity"
        style={{ opacity: behindOpacity }}
      >
        <span className="text-cream font-semibold text-sm sm:text-base">Don&apos;t have this</span>
      </div>

      <motion.div
        className={`relative z-10 rounded-mise-lg shadow-mise-lg overflow-hidden cursor-grab active:cursor-grabbing ${tierCardClass(
          recipe.tier
        )}`}
        style={{ x }}
        drag="x"
        dragConstraints={{ left: -280, right: 0 }}
        dragElastic={0.12}
        dragSnapToOrigin
        onDragEnd={(_e, info) => {
          if (info.offset.x < -100) {
            onDismiss(recipe)
          }
        }}
        onTap={() => onExpand(recipe)}
      >
        {recipe.image && (
          <div className="w-full h-40 sm:h-48 bg-forest-light overflow-hidden">
            <img
              src={recipe.image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = 'none'
              }}
            />
          </div>
        )}

        <div className="p-4">
          <div className="flex items-start gap-2">
            {resolvedTier === 'cook_tonight' && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-display font-semibold text-cream leading-snug">{recipe.title}</h3>
              {useSoonLine ? (
                <p className="mt-1 text-xs text-amber-300/90">{useSoonLine}</p>
              ) : null}
              {resolvedTier === 'check_first' && recipe.trigger_ingredient && (
                <p className="mt-2 text-sm text-amber-200/90">
                  Confirm you still have: {recipe.trigger_ingredient}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            className="mt-4 bg-terra text-cream font-semibold rounded-mise-md py-3 w-full"
            onClick={(e) => {
              e.stopPropagation()
              onCookedIt(recipe)
            }}
          >
            Cooked it
          </button>
        </div>
      </motion.div>

      {shouldShowUseSoonMeatDisclaimer(recipe, resolvedTier) && (
        <p className="mt-2 text-xs text-amber-200/90 px-1">
          Check before cooking -- this was past its use-by date
        </p>
      )}
    </div>
  )
}

export default SuggestionRecipeCard
