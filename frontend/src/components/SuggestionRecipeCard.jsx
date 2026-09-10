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

function formatCookTime(readyInMinutes) {
  const n = Number(readyInMinutes)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${n} min`
}

function formatUsesLine(highlights) {
  const names = (highlights || []).map((n) => String(n).trim()).filter(Boolean)
  if (names.length === 0) return null
  if (names.length === 1) return `Uses ${names[0]}`
  if (names.length === 2) return `Uses ${names[0]} and ${names[1]}`
  return `Uses ${names.slice(0, 2).join(', ')}, and ${names[2]}`
}

function photoFallbackLabel(recipe) {
  const fromTitle = (recipe?.title || 'Recipe').trim().slice(0, 2).toUpperCase()
  const fromHighlight = (recipe?.pantry_highlights || [])[0]
  if (fromHighlight) return String(fromHighlight).trim().slice(0, 2).toUpperCase()
  return fromTitle || '??'
}

function SuggestionRecipeCard({
  recipe,
  tier,
  onDismiss,
  onExpand,
  dismissBusy = false,
}) {
  const resolvedTier = tier ?? recipe.tier
  const useSoonLine = useSoonIngredientLine(recipe, resolvedTier)
  const cookTime = formatCookTime(recipe.readyInMinutes)
  const usesLine = formatUsesLine(recipe.pantry_highlights)
  const showAccent = resolvedTier === 'use_soon' || resolvedTier === 'check_first'
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = recipe.image && !imageFailed

  const x = useMotionValue(0)
  const [behindOpacity, setBehindOpacity] = useState(0)
  useMotionValueEvent(x, 'change', (latest) => {
    const o = Math.min(1, Math.abs(latest) / 120)
    setBehindOpacity(o)
  })

  const handleDismiss = (event) => {
    event?.stopPropagation?.()
    if (dismissBusy) return
    onDismiss(recipe)
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-meald-lg">
      <div
        className="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none z-0 transition-opacity"
        style={{
          opacity: behindOpacity,
          backgroundColor: 'color-mix(in srgb, var(--color-error) 90%, transparent)',
        }}
      >
        <span className="text-cream font-semibold text-sm sm:text-base">Not tonight</span>
      </div>

      <motion.div
        className={`relative z-10 card card-flush shadow-meald-lg overflow-hidden cursor-pointer ${
          showAccent ? 'card-accent' : ''
        }`}
        style={{ x }}
        drag={dismissBusy ? false : 'x'}
        dragConstraints={{ left: -280, right: 0 }}
        dragElastic={0.12}
        dragSnapToOrigin
        onDragEnd={(_e, info) => {
          if (dismissBusy) return
          if (info.offset.x < -100) {
            onDismiss(recipe)
          }
        }}
        onClick={(event) => {
          const target = event?.target
          const el = target?.nodeType === 3 ? target.parentElement : target
          if (el && typeof el.closest === 'function' && el.closest('button')) {
            return
          }
          onExpand(recipe)
        }}
      >
        <div className="w-full h-40 sm:h-48 bg-forest-light overflow-hidden">
          {showImage ? (
            <img
              src={recipe.image}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-2xl font-display text-sage-light"
              aria-hidden
            >
              {photoFallbackLabel(recipe)}
            </div>
          )}
        </div>

        <div className="p-4">
          <h3 className="text-lg font-display font-semibold text-cream leading-snug">
            {recipe.title}
          </h3>
          {cookTime ? (
            <p className="mt-1 text-xs text-sage-light">{cookTime}</p>
          ) : null}
          {usesLine ? (
            <p className="mt-1 text-sm text-sage-light">{usesLine}</p>
          ) : null}
          {useSoonLine ? (
            <p className="mt-1 text-sm text-terra-light">{useSoonLine}</p>
          ) : null}
          {resolvedTier === 'check_first' && recipe.trigger_ingredient ? (
            <p className="mt-2 text-sm text-terra-light">
              Confirm you still have: {recipe.trigger_ingredient}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-ghost text-sm py-2 px-3"
              disabled={dismissBusy}
              onClick={handleDismiss}
            >
              Not tonight
            </button>
          </div>
        </div>
      </motion.div>

      {shouldShowUseSoonMeatDisclaimer(recipe, resolvedTier) && (
        <p className="mt-2 text-xs text-terra-light px-1">
          Check before cooking -- this was past its use-by date
        </p>
      )}
    </div>
  )
}

export default SuggestionRecipeCard
