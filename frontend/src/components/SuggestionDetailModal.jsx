import { useEffect, useMemo, useState, useCallback } from 'react'
import AdaptiveModal from './AdaptiveModal'
import ConfidenceIndicator from './ConfidenceIndicator'
import IngredientCorrection from './IngredientCorrection'
import { api } from '../services/apiClient'
import { pantryIngredientNamesMatch } from '../utils/pantryIngredientMatch'

function findPantryVariantForIngredient(pantryData, ing) {
  if (!pantryData?.grouped || !ing) return null
  const needle = String(ing.name || '')
    .toLowerCase()
    .trim()
  const orig = String(ing.original || '')
    .toLowerCase()
    .trim()
  if (!needle && !orig) return null

  for (const g of pantryData.grouped) {
    const base = g.base_ingredient
    for (const v of g.variants || []) {
      const names = [base, v.normalized_name]
      if (
        names.some(
          (n) =>
            pantryIngredientNamesMatch(n, needle) || pantryIngredientNamesMatch(n, orig)
        )
      ) {
        return v
      }
    }
  }
  return null
}

function findFlagForIngredient(flags, ing) {
  if (!flags?.length || !ing) return null
  const needle = String(ing.name || '')
    .toLowerCase()
    .trim()
  const orig = String(ing.original || ing.name || '').toLowerCase().trim()
  for (const f of flags) {
    const fn = String(f.ingredient_name || '')
      .toLowerCase()
      .trim()
    if (!fn) continue
    if (needle && fn === needle) return f
    if (needle && (needle.includes(fn) || fn.includes(needle))) return f
    if (orig && (orig.includes(fn) || fn.includes(orig.slice(0, Math.min(fn.length + 4, orig.length))))) {
      return f
    }
  }
  return null
}

function rowKey(ing, index) {
  return ing.id != null ? String(ing.id) : `ing-${index}`
}

export function resolveRecipeFetchId(recipe) {
  return String(recipe?.recipeIdForCook || recipe?.id || '')
}

export function shouldFetchRecipeDetails(recipe) {
  const fetchId = resolveRecipeFetchId(recipe)
  if (!fetchId) return false
  if (fetchId.startsWith('staple_')) return false
  if (!/^\d+$/.test(fetchId)) return false
  if ((recipe?.extendedIngredients || []).length > 0) return false
  return true
}

export function mergeRecipeDetails(recipe, details) {
  return {
    ...recipe,
    ...details,
    id: recipe.id,
    recipeIdForCook: recipe.recipeIdForCook,
    _fromPool: recipe._fromPool,
    ingredient_flags: recipe.ingredient_flags,
    tier: recipe.tier,
    trigger_ingredient: recipe.trigger_ingredient,
  }
}

function SuggestionDetailModal({
  isOpen,
  onClose,
  recipe,
  loading,
  userId,
  pantryData,
  onCookedIt,
  onIngredientCorrected,
  cookDisabled = false,
  cookBusy = false,
}) {
  const [detailRecipe, setDetailRecipe] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedKey, setExpandedKey] = useState(null)

  const baseFlags = recipe?.ingredient_flags || []

  useEffect(() => {
    if (!isOpen) {
      setDetailRecipe(null)
      setExpandedKey(null)
      return
    }
    if (!recipe) {
      setDetailRecipe(null)
      return
    }
    if (!recipe.id || !userId) {
      setDetailRecipe(recipe)
      setDetailLoading(false)
      return
    }

    if (!shouldFetchRecipeDetails(recipe)) {
      setDetailRecipe(recipe)
      setDetailLoading(false)
      return
    }

    const fetchId = resolveRecipeFetchId(recipe)
    setDetailLoading(true)
    setDetailRecipe({ ...recipe })
    void (async () => {
      try {
        const details = await api.getRecipeDetails(userId, fetchId)
        setDetailRecipe(mergeRecipeDetails(recipe, details))
      } catch (e) {
        console.error(e)
        setDetailRecipe(recipe)
      } finally {
        setDetailLoading(false)
      }
    })()
  }, [isOpen, recipe, userId])

  const mergedLoading = loading || detailLoading

  const rows = useMemo(() => {
    const list = detailRecipe?.extendedIngredients || []
    return list.map((ingredient, index) => {
      const flag = findFlagForIngredient(baseFlags, ingredient)
      const variant = pantryData ? findPantryVariantForIngredient(pantryData, ingredient) : null
      return { ingredient, index, flag, variant, key: rowKey(ingredient, index) }
    })
  }, [detailRecipe, baseFlags, pantryData])

  const handleCorrection = useCallback(
    async (itemId, action) => {
      if (!userId) return
      await api.correctPantryItem(userId, itemId, action)
      onIngredientCorrected?.(action)
    },
    [userId, onIngredientCorrected]
  )

  const display = detailRecipe || recipe

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  return (
    <AdaptiveModal isOpen={isOpen} onClose={onClose} title={display?.title || 'Recipe'}>
      <div className="px-4 pt-2 pb-4 sm:px-6">
        {mergedLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra" />
          </div>
        ) : !display ? (
          <div className="text-center py-12">
            <p className="text-sage-light">No recipe details available.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {display.image && (
              <div className="rounded-lg overflow-hidden">
                <img
                  src={display.image}
                  alt={display.title}
                  className="w-full h-64 object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none'
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {display.readyInMinutes != null && (
                <div className="bg-forest-light p-3 rounded-mise-md">
                  <div className="text-sm text-sage-light">Ready In</div>
                  <div className="text-lg font-display font-semibold text-cream">
                    {display.readyInMinutes} minutes
                  </div>
                </div>
              )}
              {(display.servings != null || recipe?.servings != null) && (
                <div className="bg-forest-light p-3 rounded-mise-md">
                  <div className="text-sm text-sage-light">Servings</div>
                  <div className="text-lg font-display font-semibold text-cream">
                    {display.servings ?? recipe?.servings ?? 4}
                  </div>
                </div>
              )}
            </div>

            {rows.length > 0 && (
              <div>
                <h4 className="text-lg font-display font-semibold text-cream mb-3">Ingredients</h4>
                <ul className="space-y-3">
                  {rows.map(({ ingredient, flag, variant, key }) => {
                    const open = expandedKey === key
                    const canCorrect = Boolean(variant?.id)
                    const variantConfidence = variant?.confidence
                    const showConfidence =
                      flag ||
                      (variantConfidence != null && Number(variantConfidence) >= 0.2)
                    const rowInner = (
                      <>
                        <span className="text-sage-light min-w-0 flex-1">
                          {ingredient.original || ingredient.name}
                        </span>
                        {showConfidence ? (
                          <span className="flex items-center gap-2 shrink-0">
                            <ConfidenceIndicator
                              confidence={flag?.confidence ?? variantConfidence}
                              isSoftRequired={flag?.is_soft_required ?? false}
                              isUseSoon={flag?.is_use_soon ?? Boolean(variant?.use_soon)}
                              size="sm"
                            />
                          </span>
                        ) : (
                          <span className="text-xs text-sage-light/70">—</span>
                        )}
                      </>
                    )
                    return (
                      <li key={key} className="border-b border-forest-light/80 pb-3 last:border-0">
                        {canCorrect ? (
                          <button
                            type="button"
                            className="w-full text-left flex flex-wrap items-center gap-2 justify-between gap-y-1"
                            onClick={() => setExpandedKey(open ? null : key)}
                          >
                            {rowInner}
                          </button>
                        ) : (
                          <div className="w-full flex flex-wrap items-center gap-2 justify-between gap-y-1">
                            {rowInner}
                          </div>
                        )}
                        {open && canCorrect && (
                          <IngredientCorrection
                            itemId={String(variant.id)}
                            ingredientName={ingredient.original || ingredient.name}
                            onCorrection={handleCorrection}
                            onDismiss={() => setExpandedKey(null)}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {display.instructions && (
              <div>
                <h4 className="text-lg font-display font-semibold text-cream mb-3">Instructions</h4>
                {display.analyzedInstructions && display.analyzedInstructions.length > 0 ? (
                  <div className="space-y-4">
                    {display.analyzedInstructions.map((instructionGroup, groupIndex) => (
                      <div key={groupIndex}>
                        {instructionGroup.steps &&
                          instructionGroup.steps.map((step, stepIndex) => (
                            <div key={stepIndex} className="mb-4 flex gap-3">
                              <div className="flex-shrink-0 w-8 h-8 bg-terra text-cream rounded-full flex items-center justify-center font-semibold text-sm">
                                {step.number}
                              </div>
                              <div className="flex-1">
                                <p className="text-sage-light">{step.step}</p>
                              </div>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="text-sage-light prose prose-sm max-w-none prose-invert whitespace-pre-line"
                    dangerouslySetInnerHTML={{ __html: display.instructions }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="bg-forest px-4 py-3 sm:px-6 border-t border-forest-light space-y-2">
        {display && (
          <button
            type="button"
            className="w-full bg-terra text-cream font-semibold rounded-mise-md py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={cookDisabled}
            onClick={() => onCookedIt(display)}
          >
            {cookBusy ? 'Recording…' : 'Cooked it'}
          </button>
        )}
        <button type="button" onClick={onClose} className="w-full btn btn-secondary">
          Close
        </button>
      </div>
    </AdaptiveModal>
  )
}

export default SuggestionDetailModal
