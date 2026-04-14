import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import RecipeDetailModal from '../components/RecipeDetailModal'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'

function Recipes() {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [pantryData, setPantryData] = useState(null)

  const { user } = useAuth()
  const userId = user?.id

  const [householdId, setHouseholdId] = useState(null)

  const fetchPantry = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.getPantry(userId, householdId)
      setPantryData(data)
    } catch (err) {
      console.error('Failed to fetch pantry:', err)
    }
  }, [userId, householdId])

  useEffect(() => {
    fetchHousehold()
  }, [userId])

  useEffect(() => {
    if (userId) {
      fetchRecipes()
      fetchPantry()
    }
  }, [userId, householdId, fetchPantry])

  const fetchHousehold = async () => {
    try {
      const response = await api.getHousehold(userId)
      if (response.household) {
        setHouseholdId(response.household.id)
      }
    } catch (err) {
      console.error('Failed to fetch household:', err)
    }
  }

  const fetchRecipes = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getRecipes(userId, householdId)
      setRecipes(data.recipes || [])
    } catch (err) {
      console.error('Failed to fetch recipes:', err)
      setError(err.response?.data?.error || 'Failed to load recipe suggestions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleRecipeClick = async (recipe) => {
    setSelectedRecipe(null)
    setDetailModalOpen(true)
    setLoadingDetails(true)
    
    try {
      const details = await api.getRecipeDetails(userId, recipe.id)
      setSelectedRecipe(details)
    } catch (err) {
      console.error('Failed to fetch recipe details:', err)
      setError(err.response?.data?.error || 'Failed to load recipe details.')
    } finally {
      setLoadingDetails(false)
    }
  }

  return (
    <PullToRefresh onRefresh={fetchRecipes}>
    <div>
      <PageHeader
        title="Recipe Ideas"
        subtitle="Discover recipes based on ingredients in your pantry."
      />

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 border border-[var(--color-error)] rounded-mise-md text-[var(--color-error)] bg-[var(--color-error)]/10">
          {error}
          <button 
            onClick={() => setError(null)} 
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Recipes Grid */}
      <div className="card">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra"></div>
          </div>
        ) : recipes.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 bg-forest-light rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-sage-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-display font-medium text-cream mb-2">No recipes found</h3>
            <p className="text-sage-light mb-4">
              {error 
                ? 'Unable to fetch recipes. Please check your pantry items and try again.'
                : 'Add some ingredients to your pantry to get recipe suggestions.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {recipes.map((recipe) => (
              <div
                key={recipe.id}
                onClick={() => handleRecipeClick(recipe)}
                className="bg-forest-mid rounded-mise-lg shadow-card overflow-hidden cursor-pointer hover:shadow-mise-lg transition-shadow border border-forest-light"
              >
                {/* Recipe Image */}
                <div className="relative h-48 bg-forest-light">
                  {recipe.image ? (
                    <img
                      src={recipe.image}
                      alt={recipe.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23ddd" width="400" height="300"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="20" dy="10.5" font-weight="bold" x="50%25" y="50%25" text-anchor="middle"%3ENo Image%3C/text%3E%3C/svg%3E'
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-forest-mid">
                      <svg className="w-16 h-16 text-sage-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                  )}
                  
                  {/* Missing Ingredients Badge */}
                  {recipe.missedIngredientCount > 0 && (
                    <div className="absolute top-2 right-2 bg-yellow-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                      Missing {recipe.missedIngredientCount} {recipe.missedIngredientCount === 1 ? 'ingredient' : 'ingredients'}
                    </div>
                  )}
                  
                  {/* Used Ingredients Badge */}
                  {recipe.usedIngredientCount > 0 && (
                    <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                      {recipe.usedIngredientCount} {recipe.usedIngredientCount === 1 ? 'ingredient' : 'ingredients'} used
                    </div>
                  )}
                </div>
                
                {/* Recipe Title */}
                <div className="p-4">
                  <h3 className="text-lg font-display font-semibold text-cream line-clamp-2 mb-2">
                    {recipe.title}
                  </h3>
                  
                  {/* Recipe Stats */}
                  <div className="flex items-center gap-4 text-sm text-sage-light">
                    {recipe.likes > 0 && (
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                        </svg>
                        <span>{recipe.likes}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recipe Detail Modal */}
      <RecipeDetailModal
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false)
          setSelectedRecipe(null)
        }}
        recipe={selectedRecipe}
        loading={loadingDetails}
        userId={userId}
        pantryData={pantryData}
        onPantryUpdated={fetchPantry}
      />
    </div></PullToRefresh>
  )
}

export default Recipes
