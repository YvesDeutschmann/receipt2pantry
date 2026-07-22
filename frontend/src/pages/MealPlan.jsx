import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays, eachDayOfInterval } from 'date-fns'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import MealPlanWizard from '../components/MealPlanWizard'
import RecipeDetailModal from '../components/RecipeDetailModal'
import PageHeader from '../components/PageHeader'

const MealPlan = () => {
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [recipeDetailOpen, setRecipeDetailOpen] = useState(false)
  const [recipeDetailLoading, setRecipeDetailLoading] = useState(false)
  
  const { user } = useAuth()
  const userId = user?.id
  const [householdId, setHouseholdId] = useState(null)

  // Get current week
  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6)
  })

  const mealTypes = ['breakfast', 'lunch', 'dinner']

  // Load household ID
  useEffect(() => {
    const loadHousehold = async () => {
      try {
        const result = await api.getHousehold(userId)
        if (result.household) {
          setHouseholdId(result.household.id)
        }
      } catch (err) {
        console.error('Failed to load household:', err)
      }
    }
    loadHousehold()
  }, [userId])

  // Load meal plan
  const loadMealPlan = async () => {
    if (!householdId) return
    
    setLoading(true)
    setError(null)
    
    try {
      const startDate = format(weekStart, 'yyyy-MM-dd')
      const endDate = format(addDays(weekStart, 6), 'yyyy-MM-dd')
      
      const result = await api.mealPlan.getMealPlan(userId, startDate, endDate, householdId)
      setMeals(result.meals || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load meal plan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (householdId) {
      loadMealPlan()
    }
  }, [householdId, weekStart])

  // Get meal for a specific date and type
  const getMeal = (date, mealType) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return meals.find(
      m => m.meal_date === dateStr && m.meal_type === mealType
    )
  }

  // Handle meal click
  const handleMealClick = async (meal) => {
    if (meal.recipe_id && !meal.is_leftover) {
      setRecipeDetailLoading(true)
      setRecipeDetailOpen(true)
      try {
        const recipe = await api.getRecipeDetails(userId, meal.recipe_id)
        setSelectedRecipe(recipe)
      } catch (err) {
        console.error('Failed to load recipe details:', err)
        setSelectedRecipe(null)
      } finally {
        setRecipeDetailLoading(false)
      }
    }
  }

  // Handle delete meal
  const handleDeleteMeal = async (mealId) => {
    if (!confirm('Are you sure you want to delete this meal?')) return
    
    try {
      await api.mealPlan.deleteMeal(mealId)
      loadMealPlan()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete meal')
    }
  }

  const handleToggleLeftover = async (meal) => {
    try {
      await api.mealPlan.updateMeal(meal.id, { is_leftover: !meal.is_leftover })
      loadMealPlan()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update meal')
    }
  }

  // Handle wizard complete
  const handleWizardComplete = () => {
    loadMealPlan()
  }

  if (loading && !householdId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-display font-bold text-cream">Meal Plan</h1>
        <button
          className="btn btn-primary"
          onClick={() => setWizardOpen(true)}
        >
          Plan Meals
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 border border-[var(--color-error)] rounded-mise-md bg-[var(--color-error)]/10">
          <p className="text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="bg-forest-mid rounded-mise-lg shadow-card overflow-hidden border border-forest-light">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="px-4 py-3 bg-forest text-left text-sm font-semibold text-sage-light">
                  Meal
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="px-4 py-3 bg-forest text-center text-sm font-semibold text-sage-light min-w-[120px]"
                  >
                    <div>{format(day, 'EEE')}</div>
                    <div className="text-xs text-text-muted">{format(day, 'MMM d')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mealTypes.map((mealType) => (
                <tr key={mealType} className="border-t border-forest-light">
                  <td className="px-4 py-3 bg-forest text-sm font-medium text-sage-light capitalize">
                    {mealType}
                  </td>
                  {weekDays.map((day) => {
                    const meal = getMeal(day, mealType)
                    return (
                      <td
                        key={`${day.toISOString()}-${mealType}`}
                        className="px-2 py-3 border-l border-forest-light"
                      >
                        {meal ? (
                          <div
                            className="group relative p-2 bg-forest-light rounded-mise-md cursor-pointer hover:bg-forest-light/80 transition-colors"
                            onClick={() => handleMealClick(meal)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-cream truncate">
                                  {meal.recipe_name}
                                </p>
                                {meal.is_leftover && (
                                  <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-terra/20 text-terra-light rounded">
                                    Leftover
                                  </span>
                                )}
                                {meal.servings && (
                                  <p className="text-xs text-sage-light mt-1">
                                    {meal.servings} servings
                                  </p>
                                )}
                              </div>
                              {meal.recipe_image && (
                                <img
                                  src={meal.recipe_image}
                                  alt={meal.recipe_name}
                                  className="w-12 h-12 rounded object-cover ml-2"
                                  onError={(e) => {
                                    e.target.style.display = 'none'
                                  }}
                                />
                              )}
                            </div>
                            
                            {/* Hover Actions */}
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 rounded-mise-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="flex gap-2">
                                <button
                                  className="px-3 py-1 bg-forest-mid text-cream text-sm rounded-mise-sm hover:bg-forest-light"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggleLeftover(meal)
                                  }}
                                >
                                  {meal.is_leftover ? '✓ Leftover' : 'Leftover'}
                                </button>
                                <button
                                  className="px-3 py-1 bg-forest-mid text-cream text-sm rounded-mise-sm hover:bg-forest-light"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteMeal(meal.id)
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="p-2 text-center text-sage-light text-sm">
                            —
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wizard Modal */}
      <MealPlanWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onComplete={handleWizardComplete}
        userId={userId}
        householdId={householdId}
      />

      {/* Recipe Detail Modal */}
      <RecipeDetailModal
        isOpen={recipeDetailOpen}
        onClose={() => {
          setRecipeDetailOpen(false)
          setSelectedRecipe(null)
        }}
        recipe={selectedRecipe}
        loading={recipeDetailLoading}
      />
    </div>
  )
}

export default MealPlan
