import { useEffect, useMemo, useState, useCallback } from 'react'
import AdaptiveModal from './AdaptiveModal'
import UndoToast from './UndoToast'
import { api } from '../services/apiClient'

function findPantryVariantForIngredient(pantryData, ing) {
  if (!pantryData?.grouped || !ing) return null
  const needle = String(ing.name || '')
    .toLowerCase()
    .trim()
  const orig = String(ing.original || '').toLowerCase()
  if (!needle && !orig) return null

  for (const g of pantryData.grouped) {
    const base = String(g.base_ingredient || '').toLowerCase()
    for (const v of g.variants || []) {
      const nn = String(v.normalized_name || '').toLowerCase()
      if (nn && needle === nn) return v
      if (base && needle === base) return v
      if (base && needle.length >= 3 && (needle.includes(base) || base.includes(needle))) return v
      if (orig && nn && orig.includes(nn.slice(0, Math.min(12, nn.length)))) return v
    }
  }
  return null
}

function RecipeDetailModal({
  isOpen,
  onClose,
  recipe,
  loading,
  userId,
  pantryData,
  onPantryUpdated,
}) {
  const [undo, setUndo] = useState(null)

  const resetUndo = useCallback(() => setUndo(null), [])

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

  useEffect(() => {
    if (!isOpen) resetUndo()
  }, [isOpen, resetUndo])

  const handleImOut = async (variant) => {
    if (!userId || !variant?.id) return
    try {
      const { snapshot } = await api.depletePantryItem(userId, variant.id)
      const name = snapshot?.normalized_name || snapshot?.base_ingredient || 'Item'
      setUndo({ snapshot, message: `Removed ${name} from your pantry` })
      onPantryUpdated?.()
    } catch (e) {
      console.error(e)
    }
  }

  const handleUndo = async () => {
    if (!undo?.snapshot || !userId) return
    try {
      await api.restorePantryItem(userId, undo.snapshot)
      setUndo(null)
      onPantryUpdated?.()
    } catch (e) {
      console.error(e)
    }
  }

  const rows = useMemo(() => {
    const list = recipe?.extendedIngredients || []
    return list.map((ingredient, index) => {
      const variant = pantryData ? findPantryVariantForIngredient(pantryData, ingredient) : null
      return { ingredient, index, variant }
    })
  }, [recipe, pantryData])

  return (
    <>
      <AdaptiveModal isOpen={isOpen} onClose={onClose} title={recipe?.title || 'Recipe Details'}>
        <div className="px-4 pt-2 pb-4 sm:px-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
            </div>
          ) : !recipe ? (
            <div className="text-center py-12">
              <p className="text-sage-light">No recipe details available.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {recipe.image && (
                <div className="rounded-lg overflow-hidden">
                  <img
                    src={recipe.image}
                    alt={recipe.title}
                    className="w-full h-64 object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {recipe.readyInMinutes && (
                  <div className="bg-forest-light p-3 rounded-mise-md">
                    <div className="text-sm text-sage-light">Ready In</div>
                    <div className="text-lg font-display font-semibold text-cream">
                      {recipe.readyInMinutes} minutes
                    </div>
                  </div>
                )}
                {recipe.servings && (
                  <div className="bg-forest-light p-3 rounded-mise-md">
                    <div className="text-sm text-sage-light">Servings</div>
                    <div className="text-lg font-display font-semibold text-cream">{recipe.servings}</div>
                  </div>
                )}
              </div>

              {recipe.summary && (
                <div>
                  <h4 className="text-lg font-display font-semibold text-cream mb-2">About</h4>
                  <div
                    className="text-sage-light prose prose-sm max-w-none prose-invert prose-p:leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: recipe.summary }}
                  />
                </div>
              )}

              {rows.length > 0 && (
                <div>
                  <h4 className="text-lg font-display font-semibold text-cream mb-3">Ingredients</h4>
                  <ul className="space-y-2">
                    {rows.map(({ ingredient, index, variant }) => (
                      <li
                        key={ingredient.id ?? index}
                        className="flex items-start gap-2 justify-between group"
                      >
                        <span className="text-sage-light flex items-start gap-2 min-w-0">
                          <span className="text-terra mt-1 shrink-0">•</span>
                          <span>{ingredient.original || ingredient.name}</span>
                        </span>
                        {variant && userId && (
                          <button
                            type="button"
                            onClick={() => handleImOut(variant)}
                            className="shrink-0 text-[11px] uppercase tracking-wide text-sage-light hover:text-terra px-2 py-0.5 rounded border border-sage/25 opacity-80 group-hover:opacity-100"
                          >
                            Out
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {userId && pantryData && (
                    <p className="mt-3 text-xs text-sage-light">Tap &quot;Out&quot; if you&apos;re out of something we matched in your pantry.</p>
                  )}
                </div>
              )}

              {recipe.instructions && (
                <div>
                  <h4 className="text-lg font-display font-semibold text-cream mb-3">Instructions</h4>
                  {recipe.analyzedInstructions && recipe.analyzedInstructions.length > 0 ? (
                    <div className="space-y-4">
                      {recipe.analyzedInstructions.map((instructionGroup, groupIndex) => (
                        <div key={groupIndex}>
                          {instructionGroup.steps &&
                            instructionGroup.steps.map((step, stepIndex) => (
                              <div key={stepIndex} className="mb-4 flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-terra text-cream rounded-full flex items-center justify-center font-semibold text-sm">
                                  {step.number}
                                </div>
                                <div className="flex-1">
                                  <p className="text-sage-light">{step.step}</p>
                                  {step.equipment && step.equipment.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {step.equipment.map((eq, eqIndex) => (
                                        <span
                                          key={eqIndex}
                                          className="px-2 py-1 bg-forest-light text-sage-light text-xs rounded"
                                        >
                                          {eq.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="text-sage-light prose prose-sm max-w-none prose-invert whitespace-pre-line"
                      dangerouslySetInnerHTML={{ __html: recipe.instructions }}
                    />
                  )}
                </div>
              )}

              {(recipe.sourceUrl || recipe.spoonacularSourceUrl) && (
                <div className="pt-4 border-t border-forest-light">
                  <h4 className="text-sm font-semibold text-cream mb-2">Source</h4>
                  <div className="flex flex-wrap gap-2">
                    {recipe.sourceUrl && (
                      <a
                        href={recipe.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terra hover:text-terra-light text-sm underline"
                      >
                        Original Recipe
                      </a>
                    )}
                    {recipe.spoonacularSourceUrl && (
                      <a
                        href={recipe.spoonacularSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terra hover:text-terra-light text-sm underline"
                      >
                        View on Spoonacular
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="bg-forest px-4 py-3 sm:px-6 border-t border-forest-light">
          <button type="button" onClick={onClose} className="w-full sm:w-auto btn btn-primary">
            Close
          </button>
        </div>
      </AdaptiveModal>

      <UndoToast
        open={Boolean(undo)}
        message={undo?.message || ''}
        onAction={handleUndo}
        onDismiss={resetUndo}
      />
    </>
  )
}

export default RecipeDetailModal
