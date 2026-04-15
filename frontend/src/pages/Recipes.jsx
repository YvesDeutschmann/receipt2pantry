import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import HealthCard from '../components/HealthCard'
import SuggestionDetailModal from '../components/SuggestionDetailModal'
import SuggestionRecipeCard from '../components/SuggestionRecipeCard'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'

const EMPTY_SUGGESTIONS = {
  use_soon_shelf: [],
  cook_tonight: [],
  probably_have: [],
  check_first: [],
}

function orderedUseSoonNames(shelfRecipes) {
  const ordered = []
  const seen = new Set()
  for (const r of shelfRecipes) {
    for (const f of r.ingredient_flags || []) {
      if (f.is_use_soon && f.ingredient_name) {
        const n = String(f.ingredient_name).trim()
        const key = n.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          ordered.push(n)
        }
      }
    }
  }
  return ordered
}

function useSoonShelfSubtitle(shelfRecipes) {
  const names = orderedUseSoonNames(shelfRecipes)
  if (names.length === 0) return null
  if (names.length >= 3) return 'Recipes using what needs using up'
  if (names.length === 1) return `Recipes using your ${names[0]}`
  return `Recipes using your ${names[0]} and ${names[1]}`
}

function Recipes() {
  const [suggestions, setSuggestions] = useState(EMPTY_SUGGESTIONS)
  const [loading, setLoading] = useState(true)
  const [healthCardVisible, setHealthCardVisible] = useState(false)
  const [healthCardItems, setHealthCardItems] = useState([])
  const [cookedConfirmation, setCookedConfirmation] = useState(null)
  const [error, setError] = useState(null)
  const [householdId, setHouseholdId] = useState(null)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [pantryData, setPantryData] = useState(null)

  const { user } = useAuth()
  const userId = user?.id

  const initialLoadDoneRef = useRef(false)

  const fetchPantry = useCallback(async () => {
    if (!userId) return
    try {
      const data = await api.getPantry(userId, householdId)
      setPantryData(data)
    } catch (err) {
      console.error('Failed to fetch pantry:', err)
    }
  }, [userId, householdId])

  const fetchHousehold = useCallback(async () => {
    if (!userId) return
    try {
      const response = await api.getHousehold(userId)
      if (response.household) {
        setHouseholdId(response.household.id)
      }
    } catch (err) {
      console.error('Failed to fetch household:', err)
    }
  }, [userId])

  const loadSuggestions = useCallback(async () => {
    if (!userId) return
    if (!initialLoadDoneRef.current) {
      setLoading(true)
    }
    setError(null)
    try {
      const data = await api.getSuggestions(userId, householdId)
      initialLoadDoneRef.current = true
      setSuggestions({
        use_soon_shelf: data.use_soon_shelf || [],
        cook_tonight: data.cook_tonight || [],
        probably_have: data.probably_have || [],
        check_first: data.check_first || [],
      })
    } catch (err) {
      console.error('Failed to load suggestions:', err)
      setError(err.response?.data?.error || 'Failed to load recipe suggestions.')
      setSuggestions(EMPTY_SUGGESTIONS)
    } finally {
      setLoading(false)
    }
  }, [userId, householdId])

  useEffect(() => {
    void fetchHousehold()
  }, [fetchHousehold])

  useEffect(() => {
    if (!userId) return
    void loadSuggestions()
    void fetchPantry()
  }, [userId, householdId, loadSuggestions, fetchPantry])

  const handleRefreshPull = async () => {
    await loadSuggestions()
  }

  const handleCookedIt = async (recipe) => {
    if (!userId) return
    const flags = recipe.ingredient_flags || []
    const ingredients =
      flags.length > 0
        ? flags.map((f) => ({
            name: f.ingredient_name,
            amount: 1,
            unit: 'serving',
          }))
        : [{ name: recipe.title || 'meal', amount: 1, unit: 'serving' }]
    try {
      await api.markCooked(userId, {
        recipeId: recipe.id,
        recipeName: recipe.title,
        servings: recipe.servings || 4,
        ingredients,
        householdId,
      })
      setCookedConfirmation('Nice! Pantry updated.')
      setTimeout(() => setCookedConfirmation(null), 2500)
      const updated = await api.getSuggestions(userId, householdId)
      setSuggestions({
        use_soon_shelf: updated.use_soon_shelf || [],
        cook_tonight: updated.cook_tonight || [],
        probably_have: updated.probably_have || [],
        check_first: updated.check_first || [],
      })
      void fetchPantry()
      try {
        const hc = await api.getHealthCard(userId, householdId)
        if (hc.show && hc.items?.length > 0) {
          setHealthCardItems(hc.items)
          setHealthCardVisible(true)
        }
      } catch {
        /* health card is non-critical */
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record cook event.')
    }
  }

  const handleDismiss = async (recipe) => {
    setSuggestions((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter((r) => r.id !== recipe.id)
      }
      return next
    })
    if (!userId) return
    try {
      await api.dismissSuggestion(userId, recipe.id, householdId)
    } catch (err) {
      console.error('dismiss failed', err)
    }
  }

  const handleExpand = (recipe) => {
    setSelectedRecipe(recipe)
    setDetailModalOpen(true)
  }

  const renderShelf = (key, title, subtitle, list) => {
    if (!list || list.length === 0) return null
    return (
      <section key={key} className="mb-8">
        <div className="mb-4">
          <h2 className="text-xl font-display font-semibold text-cream mb-1">{title}</h2>
          {subtitle ? <p className="text-sm text-sage-light">{subtitle}</p> : null}
        </div>
        {list.map((recipe) => (
          <SuggestionRecipeCard
            key={`${key}-${recipe.id}`}
            recipe={recipe}
            tier={key}
            onCookedIt={handleCookedIt}
            onDismiss={handleDismiss}
            onExpand={handleExpand}
          />
        ))}
      </section>
    )
  }

  const hasAnyRecipes =
    (suggestions.use_soon_shelf?.length || 0) +
      (suggestions.cook_tonight?.length || 0) +
      (suggestions.probably_have?.length || 0) +
      (suggestions.check_first?.length || 0) >
    0

  return (
    <PullToRefresh onRefresh={handleRefreshPull}>
      <div>
        <PageHeader
          title="Recipe Ideas"
          subtitle="Discover recipes based on ingredients in your pantry."
        />

        {cookedConfirmation && (
          <div className="mb-4 p-3 rounded-mise-md bg-forest-light text-cream text-center text-sm border border-forest-light">
            {cookedConfirmation}
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 border border-[var(--color-error)] rounded-mise-md text-[var(--color-error)] bg-[var(--color-error)]/10">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 underline hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="card">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra" />
            </div>
          ) : !hasAnyRecipes ? (
            <div className="text-center py-12">
              <div className="mx-auto w-16 h-16 bg-forest-light rounded-full flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-sage-light"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-display font-medium text-cream mb-2">No suggestions yet</h3>
              <p className="text-sage-light mb-4">
                Pull down to refresh or add pantry items—we will match recipes to what you have.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => void loadSuggestions()}>
                Refresh suggestions
              </button>
            </div>
          ) : (
            <div className="w-full max-w-lg mx-auto">
              {renderShelf(
                'use_soon',
                'Use before it\'s gone',
                useSoonShelfSubtitle(suggestions.use_soon_shelf),
                suggestions.use_soon_shelf
              )}
              {renderShelf('cook_tonight', 'Cook tonight', null, suggestions.cook_tonight)}
              {renderShelf(
                'probably_have',
                'Probably have everything',
                null,
                suggestions.probably_have
              )}
              {renderShelf('check_first', 'Quick check needed', null, suggestions.check_first)}
            </div>
          )}
        </div>

        <SuggestionDetailModal
          isOpen={detailModalOpen}
          onClose={() => {
            setDetailModalOpen(false)
            setSelectedRecipe(null)
          }}
          recipe={selectedRecipe}
          loading={false}
          userId={userId}
          pantryData={pantryData}
          onCookedIt={async (r) => {
            await handleCookedIt(r)
            setDetailModalOpen(false)
            setSelectedRecipe(null)
          }}
          onIngredientCorrected={() => {
            void loadSuggestions()
            void fetchPantry()
          }}
        />

        {userId ? (
          <HealthCard
            userId={userId}
            items={healthCardItems}
            visible={healthCardVisible}
            onDismiss={() => {
              setHealthCardVisible(false)
              setHealthCardItems([])
            }}
            onItemUpdated={async () => {
              const updated = await api.getSuggestions(userId, householdId)
              setSuggestions({
                use_soon_shelf: updated.use_soon_shelf || [],
                cook_tonight: updated.cook_tonight || [],
                probably_have: updated.probably_have || [],
                check_first: updated.check_first || [],
              })
              await fetchPantry()
            }}
          />
        ) : null}
      </div>
    </PullToRefresh>
  )
}

export default Recipes
