import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import RecipeDetailModal from '../components/RecipeDetailModal'
import RecipeSwipeCard from '../components/RecipeSwipeCard'
import PageHeader from '../components/PageHeader'
import PullToRefresh from '../components/PullToRefresh'

const MEALS = ['breakfast', 'lunch', 'dinner']

const defaultSlots = () => ({
  breakfast: true,
  lunch: true,
  dinner: true,
})

function mealTypesFromSlots(slots) {
  return MEALS.filter((m) => slots[m])
}

function flattenPool(poolGrouped, mealOrder) {
  const rows = []
  for (const mt of mealOrder) {
    const list = poolGrouped[mt] || []
    rows.push(...list)
  }
  return rows
}

function rowToCardRecipe(row) {
  const data = row.recipe_data || {}
  const id = data.id ?? row.recipe_id
  return {
    ...data,
    id,
    title: data.title || row.recipe_name,
    image: data.image || row.recipe_image,
    poolSuggestionId: row.id,
    meal_type: row.meal_type,
  }
}

function needsRefill(depth, slots) {
  const types = mealTypesFromSlots(slots)
  if (!types.length) return false
  const total = types.reduce((s, m) => s + (depth[m] ?? 0), 0)
  const minTotal = 2 * types.length
  if (total < minTotal) return true
  return false
}

function Recipes() {
  const [deck, setDeck] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [pantryData, setPantryData] = useState(null)
  const [householdId, setHouseholdId] = useState(null)
  const [mealSlots, setMealSlots] = useState(defaultSlots)
  const [generatingHint, setGeneratingHint] = useState(false)

  const { user } = useAuth()
  const userId = user?.id

  const mealOrder = useMemo(() => mealTypesFromSlots(mealSlots), [mealSlots])

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
        const s = response.household.suggestion_meal_slots
        if (s && typeof s === 'object') {
          setMealSlots({
            breakfast: !!s.breakfast,
            lunch: !!s.lunch,
            dinner: !!s.dinner,
          })
        }
      }
    } catch (err) {
      console.error('Failed to fetch household:', err)
    }
  }, [userId])

  const loadPoolFromApi = useCallback(
    async (slotsOverride) => {
      if (!userId || !householdId) return
      // #region agent log
      const _tLoad = performance.now()
      // #endregion
      const data = await api.suggestions.getPool(userId, householdId)
      const slots = slotsOverride !== undefined ? slotsOverride : mealSlots
      const order = mealTypesFromSlots(slots)
      const rows = flattenPool(data.pool || {}, order.length ? order : MEALS)
      setDeck(rows.map(rowToCardRecipe))
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:loadPoolFromApi',message:'getPool done',data:{elapsedMs:Math.round(performance.now()-_tLoad),rowCount:rows.length,mealOrder:order},timestamp:Date.now(),hypothesisId:'H2-H5'})}).catch(()=>{});
      // #endregion
    },
    [userId, householdId, mealSlots]
  )

  const maybeTriggerRegeneration = useCallback(
    async (triggerReason, { useMealTypes, slotsForReload } = {}) => {
      if (!userId || !householdId) return
      const types = useMealTypes ?? mealTypesFromSlots(mealSlots)
      if (!types.length) return
      // #region agent log
      const _tGen = performance.now()
      fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:maybeTriggerRegeneration:start',message:'triggerGeneration start',data:{triggerReason,mealTypes:types},timestamp:Date.now(),hypothesisId:'H1-H4'})}).catch(()=>{});
      // #endregion
      try {
        setGeneratingHint(true)
        await api.suggestions.triggerGeneration(userId, {
          triggerReason,
          householdId,
          mealTypes: types,
        })
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:maybeTriggerRegeneration:afterPost',message:'triggerGeneration HTTP returned',data:{elapsedMs:Math.round(performance.now()-_tGen),triggerReason},timestamp:Date.now(),hypothesisId:'H1-H4'})}).catch(()=>{});
        // #endregion
        await loadPoolFromApi(slotsForReload)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:maybeTriggerRegeneration:afterReload',message:'loadPool after generation',data:{totalElapsedMs:Math.round(performance.now()-_tGen),triggerReason},timestamp:Date.now(),hypothesisId:'H1-H2'})}).catch(()=>{});
        // #endregion
      } catch (e) {
        console.warn('Pool generation:', e?.message || e)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:maybeTriggerRegeneration:error',message:'trigger failed',data:{elapsedMs:Math.round(performance.now()-_tGen),err:String(e?.message||e)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
        // #endregion
      } finally {
        setGeneratingHint(false)
      }
    },
    [userId, householdId, mealSlots, loadPoolFromApi]
  )

  const checkDepthAndRefill = useCallback(
    async () => {
      if (!userId || !householdId) return
      try {
        // #region agent log
        const _tDepth = performance.now()
        // #endregion
        const { depth } = await api.suggestions.getDepth(userId, householdId)
        const needs = needsRefill(depth, mealSlots)
        const types = mealTypesFromSlots(mealSlots)
        const totalUnused = types.reduce((s, m) => s + (depth[m] ?? 0), 0)
        const allEmpty = types.length && types.every((mt) => (depth[mt] ?? 0) === 0)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:checkDepthAndRefill',message:'depth after getDepth',data:{elapsedMs:Math.round(performance.now()-_tDepth),depth,needsRefill:needs,totalUnused,minTotal:2*types.length,allEmpty,refillFireAndForget:true},timestamp:Date.now(),hypothesisId:'H1-H4'})}).catch(()=>{});
        // #endregion
        if (!needs) return
        void maybeTriggerRegeneration('low_watermark', {})
      } catch (e) {
        console.warn('depth check', e)
      }
    },
    [userId, householdId, mealSlots, maybeTriggerRegeneration]
  )

  const fetchRecipes = useCallback(async () => {
    if (!userId) return
    // #region agent log
    const _tFetch = performance.now()
    fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:fetchRecipes:start',message:'fetchRecipes start',data:{householdId,mealSlots},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    setLoading(true)
    setError(null)
    try {
      await loadPoolFromApi()
      if (mealTypesFromSlots(mealSlots).length) {
        await checkDepthAndRefill()
        await loadPoolFromApi()
      }
    } catch (err) {
      console.error('Failed to load suggestion pool:', err)
      setError(err.response?.data?.error || 'Failed to load recipe suggestions.')
    } finally {
      setLoading(false)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/756eb072-bf2c-4867-826e-94b8531d6a1d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef2920'},body:JSON.stringify({sessionId:'ef2920',location:'Recipes.jsx:fetchRecipes:finally',message:'fetchRecipes done loading=false',data:{totalElapsedMs:Math.round(performance.now()-_tFetch)},timestamp:Date.now(),hypothesisId:'H1-H3'})}).catch(()=>{});
      // #endregion
    }
  }, [userId, loadPoolFromApi, checkDepthAndRefill, mealSlots])

  useEffect(() => {
    fetchHousehold()
  }, [fetchHousehold])

  useEffect(() => {
    if (userId && householdId) {
      fetchRecipes()
      fetchPantry()
    }
  }, [userId, householdId, fetchRecipes, fetchPantry])

  const toggleMealSlot = async (key) => {
    const next = { ...mealSlots, [key]: !mealSlots[key] }
    if (!next.breakfast && !next.lunch && !next.dinner) {
      setError('Select at least one meal type.')
      return
    }
    setMealSlots(next)
    setError(null)
    if (!userId) return
    try {
      await api.updateHouseholdProfile(userId, { suggestionMealSlots: next })
      void maybeTriggerRegeneration('manual_refresh', {
        useMealTypes: mealTypesFromSlots(next),
        slotsForReload: next,
      })
    } catch (e) {
      console.error(e)
      setError(e.response?.data?.error || 'Could not save meal preferences.')
    }
  }

  const handleRefreshPull = async () => {
    await maybeTriggerRegeneration('manual_refresh', {})
  }

  const handleRecipeClick = async (recipe) => {
    const rid = recipe?.id
    const isStaple =
      recipe?.is_staple || String(rid || '').startsWith('staple_')
    setSelectedRecipe(null)
    setDetailModalOpen(true)
    if (isStaple || !rid || !userId) {
      setSelectedRecipe({
        id: rid,
        title: recipe.title,
        image: recipe.image,
        extendedIngredients: [],
        instructions: '',
        summary: '',
        is_staple: true,
      })
      setLoadingDetails(false)
      return
    }
    const hasDetail =
      recipe.extendedIngredients &&
      Array.isArray(recipe.extendedIngredients) &&
      recipe.extendedIngredients.length > 0
    if (hasDetail) {
      setSelectedRecipe(recipe)
      setLoadingDetails(false)
      return
    }
    setLoadingDetails(true)
    try {
      const details = await api.getRecipeDetails(userId, rid)
      setSelectedRecipe(details)
    } catch (err) {
      console.error('Failed to fetch recipe details:', err)
      setError(err.response?.data?.error || 'Failed to load recipe details.')
    } finally {
      setLoadingDetails(false)
    }
  }

  const removeTopAndSwipe = async (recipe) => {
    const sid = recipe.poolSuggestionId
    if (!sid || !userId) return
    setDeck((prev) => prev.filter((r) => r.poolSuggestionId !== sid))
    try {
      await api.suggestions.swipe(userId, sid, householdId)
    } catch (e) {
      console.error(e)
      setError(e.response?.data?.error || 'Could not update suggestion.')
    }
    void checkDepthAndRefill()
  }

  const topThree = deck.slice(0, 3)

  return (
    <PullToRefresh onRefresh={handleRefreshPull}>
      <div>
        <PageHeader
          title="Recipe Ideas"
          subtitle="Discover recipes based on ingredients in your pantry."
        />

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

        <div className="card mb-4">
          <p className="text-sm text-sage-light mb-2">
            Include these meals in your suggestion pool (used for background generation):
          </p>
          <div className="flex flex-wrap gap-3">
            {MEALS.map((m) => (
              <label
                key={m}
                className="inline-flex items-center gap-2 cursor-pointer text-cream capitalize"
              >
                <input
                  type="checkbox"
                  checked={!!mealSlots[m]}
                  onChange={() => toggleMealSlot(m)}
                  className="rounded border-forest-light"
                />
                {m}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra" />
            </div>
          ) : deck.length === 0 ? (
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
              <h3 className="text-lg font-display font-medium text-cream mb-2">
                {generatingHint ? 'Generating suggestions…' : 'No suggestions yet'}
              </h3>
              <p className="text-sage-light mb-4">
                {generatingHint
                  ? 'We are filling your pool in the background. Pull to refresh or check back in a moment.'
                  : 'Pull down to refresh or add pantry items—we will match recipes to what you have.'}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => maybeTriggerRegeneration('manual_refresh', {})}
              >
                Refresh suggestions
              </button>
            </div>
          ) : (
            <div
              className="relative mb-6 w-full max-w-lg mx-auto"
              style={{ minHeight: '520px' }}
            >
              <p className="text-xs text-sage-light mb-2 text-center">
                Swipe right to open details · Swipe left to dismiss · Swipe up to dismiss
              </p>
              <AnimatePresence>
                {topThree.map((recipe, index) => (
                  <motion.div
                    key={recipe.poolSuggestionId || recipe.id || index}
                    className="absolute inset-x-0 w-full"
                    style={{
                      zIndex: 3 - index,
                      transformOrigin: 'top center',
                      transform: `scale(${1 - index * 0.05}) translateY(${index * 10}px)`,
                    }}
                  >
                    <RecipeSwipeCard
                      recipe={recipe}
                      onAccept={() => handleRecipeClick(recipe)}
                      onReject={() => removeTopAndSwipe(recipe)}
                      onBan={() => removeTopAndSwipe(recipe)}
                      isFirstCard={index === 0}
                      zIndex={3 - index}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

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
      </div>
    </PullToRefresh>
  )
}

export default Recipes
