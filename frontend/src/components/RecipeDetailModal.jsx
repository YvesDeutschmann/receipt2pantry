import { useEffect } from 'react'
import AdaptiveModal from './AdaptiveModal'

function RecipeDetailModal({ isOpen, onClose, recipe, loading }) {
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
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={recipe?.title || 'Recipe Details'}
    >
      <div className="px-4 pt-2 pb-4 sm:px-6">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
            ) : !recipe ? (
              <div className="text-center py-12">
                <p className="text-gray-600">No recipe details available.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Recipe Image */}
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

                {/* Recipe Info */}
                <div className="grid grid-cols-2 gap-4">
                  {recipe.readyInMinutes && (
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="text-sm text-gray-600">Ready In</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {recipe.readyInMinutes} minutes
                      </div>
                    </div>
                  )}
                  {recipe.servings && (
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <div className="text-sm text-gray-600">Servings</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {recipe.servings}
                      </div>
                    </div>
                  )}
                </div>

                {/* Summary */}
                {recipe.summary && (
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">About</h4>
                    <div 
                      className="text-gray-700 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: recipe.summary }}
                    />
                  </div>
                )}

                {/* Ingredients */}
                {recipe.extendedIngredients && recipe.extendedIngredients.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-3">Ingredients</h4>
                    <ul className="space-y-2">
                      {recipe.extendedIngredients.map((ingredient, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-primary-600 mt-1">•</span>
                          <span className="text-gray-700">
                            {ingredient.original || ingredient.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Instructions */}
                {recipe.instructions && (
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-3">Instructions</h4>
                    {recipe.analyzedInstructions && recipe.analyzedInstructions.length > 0 ? (
                      // Use structured instructions if available
                      <div className="space-y-4">
                        {recipe.analyzedInstructions.map((instructionGroup, groupIndex) => (
                          <div key={groupIndex}>
                            {instructionGroup.steps && instructionGroup.steps.map((step, stepIndex) => (
                              <div key={stepIndex} className="mb-4 flex gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                                  {step.number}
                                </div>
                                <div className="flex-1">
                                  <p className="text-gray-700">{step.step}</p>
                                  {step.equipment && step.equipment.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {step.equipment.map((eq, eqIndex) => (
                                        <span key={eqIndex} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
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
                      // Fallback to plain text instructions
                      <div 
                        className="text-gray-700 prose prose-sm max-w-none whitespace-pre-line"
                        dangerouslySetInnerHTML={{ __html: recipe.instructions }}
                      />
                    )}
                  </div>
                )}

                {/* Source Links */}
                {(recipe.sourceUrl || recipe.spoonacularSourceUrl) && (
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Source</h4>
                    <div className="flex flex-wrap gap-2">
                      {recipe.sourceUrl && (
                        <a
                          href={recipe.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-700 text-sm underline"
                        >
                          Original Recipe
                        </a>
                      )}
                      {recipe.spoonacularSourceUrl && (
                        <a
                          href={recipe.spoonacularSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-700 text-sm underline"
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
      <div className="bg-gray-50 px-4 py-3 sm:px-6 border-t border-gray-200">
        <button
          type="button"
          onClick={onClose}
          className="w-full sm:w-auto btn btn-primary"
        >
          Close
        </button>
      </div>
    </AdaptiveModal>
  )
}

export default RecipeDetailModal
