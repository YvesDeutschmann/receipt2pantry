import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, postDevLog } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import { emit, emitRepeatable, FunnelEvent } from '../services/funnelTelemetry'
import HealthCard from '../components/HealthCard'
import IngredientCorrection from '../components/IngredientCorrection'
import { APP_OVERLAY_Z_CLASS } from '../components/AdaptiveModal'
import SuggestionDetailModal, {
  EXIT_CONFIRM_VIEW_THRESHOLD_MS,
} from '../components/SuggestionDetailModal'
import SuggestionRecipeCard from '../components/SuggestionRecipeCard'
import PageHeader from '../components/PageHeader'
import NeedsAttentionSection from '../components/NeedsAttentionSection'
import PullToRefresh from '../components/PullToRefresh'
import { buildCookIngredients, isStapleRecipeId } from '../utils/buildCookIngredients'
import {
  capCookTonight,
  suggestionCardKey,
} from '../utils/dinnerPickerRank'
import {
  clientCookLoopChecks,
  compactCookLoopQaLog,
  isDevCookLoopRecipe,
  stashCookLoopReport,
} from '../utils/cookLoopQa'

const EMPTY_SUGGESTIONS = {
  use_soon_shelf: [],
  cook_tonight: [],
  probably_have: [],
  check_first: [],
}

const COOK_PARTIAL_ERROR =
  'Cook may be partially recorded. Check your pantry before logging again.'
const OPEN_RECIPE_MESSAGE = 'Open the recipe to log what you used.'

function cookConfirmationMessage(touched) {
  if (!touched?.length) {
    return 'Logged. Nothing in your pantry matched this recipe.'
  }
  const names = touched
    .map((item) => item.base_ingredient)
    .filter(Boolean)
  if (names.length === 0) {
    return 'Logged. Pantry updated.'
  }
  if (names.length === 1) {
    return `Used ${names[0]} from your pantry.`
  }
  return `Used ${names.slice(0, 3).join(', ')} from your pantry.`
}

function normalizeSuggestionCard(recipe) {
  const fromPool = Boolean(recipe?.pool_suggestion_id)
  return {
    ...recipe,
    recipeIdForCook: recipe.id,
    _fromPool: fromPool,
  }
}

function normalizeSuggestionsPayload(data) {
  const src = data || EMPTY_SUGGESTIONS
  return {
    use_soon_shelf: (src.use_soon_shelf || []).map(normalizeSuggestionCard),
    cook_tonight: (src.cook_tonight || []).map(normalizeSuggestionCard),
    probably_have: (src.probably_have || []).map(normalizeSuggestionCard),
    check_first: (src.check_first || []).map(normalizeSuggestionCard),
  }
}

async function fetchSuggestionsPayload(userId, householdId) {
  const liveData = await api.getSuggestions(userId, householdId)
  return { suggestions: normalizeSuggestionsPayload(liveData) }
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
  const [postCookPerishables, setPostCookPerishables] = useState([])
  const [error, setError] = useState(null)
  const [householdId, setHouseholdId] = useState(null)
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [exitConfirmRecipe, setExitConfirmRecipe] = useState(null)
  const [pantryData, setPantryData] = useState(null)
  const [showMoreCookTonight, setShowMoreCookTonight] = useState(false)
  const [cookingRecipeIds, setCookingRecipeIds] = useState(() => new Set())
  const [dismissingCardKeys, setDismissingCardKeys] = useState(() => new Set())

  const { user } = useAuth()
  const userId = user?.id

  const initialLoadDoneRef = useRef(false)
  const lowWatermarkInFlightRef = useRef(false)
  const firstSuggestionEmitted = useRef(false)
  const firstCookEmitted = useRef(false)
  const cookInFlightRef = useRef(new Set())
  const cookedPoolIdsRef = useRef(new Set())
  const exitConfirmSuppressedRef = useRef(new Set())

  const syncCookingUi = useCallback(() => {
    setCookingRecipeIds(new Set(cookInFlightRef.current))
  }, [])

  useEffect(() => {
    setShowMoreCookTonight(false)
    cookedPoolIdsRef.current = new Set()
    exitConfirmSuppressedRef.current = new Set()
    firstSuggestionEmitted.current = false
    cookInFlightRef.current = new Set()
    syncCookingUi()
  }, [userId, syncCookingUi])

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

  const maybeTriggerLowWatermarkRefill = useCallback(async () => {
    if (!userId || lowWatermarkInFlightRef.current) return
    lowWatermarkInFlightRef.current = true
    try {
      const res = await api.suggestions.getDepth(userId, householdId)
      const depth = res.depth || {}
      const slots = ['breakfast', 'lunch', 'dinner']
      const anyLow = slots.some((k) => (depth[k] ?? 0) < 2)
      if (anyLow) {
        void api.suggestions
          .triggerGeneration(userId, {
            triggerReason: 'low_watermark',
            householdId,
          })
          .catch(() => {})
      }
    } catch (e) {
      console.warn('Low-watermark check failed:', e)
    } finally {
      lowWatermarkInFlightRef.current = false
    }
  }, [userId, householdId])

  const loadSuggestions = useCallback(async () => {
    if (!userId) return
    if (!initialLoadDoneRef.current) {
      setLoading(true)
    }
    setError(null)
    try {
      const { suggestions: next } = await fetchSuggestionsPayload(userId, householdId)
      initialLoadDoneRef.current = true
      setSuggestions(next)
      const hasAnySuggestion =
        (next.use_soon_shelf?.length > 0) ||
        (next.cook_tonight?.length > 0) ||
        (next.probably_have?.length > 0) ||
        (next.check_first?.length > 0)
      if (hasAnySuggestion && userId && !firstSuggestionEmitted.current) {
        firstSuggestionEmitted.current = true
        void emit(FunnelEvent.FIRST_SUGGESTION_VIEWED, userId)
      }
    } catch (err) {
      console.error('Failed to load suggestions:', err)
      const status = err.response?.status
      const apiError = err.response?.data?.error
      if (status === 429 || err.response?.data?.code === 'recipe_quota') {
        setError(
          apiError ||
            'Daily recipe lookup limit reached. Suggestions will refresh tomorrow.'
        )
      } else {
        setError(apiError || 'Failed to load recipe suggestions.')
      }
      setSuggestions(EMPTY_SUGGESTIONS)
    } finally {
      setLoading(false)
    }
  }, [userId, householdId])

  const regeneratePoolThenReload = useCallback(async () => {
    if (userId) {
      try {
        await api.suggestions.triggerGeneration(userId, {
          triggerReason: 'manual_refresh',
          householdId,
        })
      } catch {
        /* still reload whatever pool is currently unused */
      }
    }
    await loadSuggestions()
  }, [userId, householdId, loadSuggestions])

  useEffect(() => {
    void fetchHousehold()
  }, [fetchHousehold])

  useEffect(() => {
    if (!userId) return
    void loadSuggestions()
    void fetchPantry()
  }, [userId, householdId, loadSuggestions, fetchPantry])

  const handleRefreshPull = async () => {
    await regeneratePoolThenReload()
  }

  const handlePostCookCorrection = async (itemId, action) => {
    if (!userId) return
    await api.correctPantryItem(userId, itemId, action)
    setPostCookPerishables((prev) =>
      prev.filter((item) => String(item.pantry_item_id) !== String(itemId))
    )
    if (action === 'used_it_up' || action === 'never_had_it') {
      await regeneratePoolThenReload()
    } else {
      await loadSuggestions()
    }
    void fetchPantry()
  }

  const handleCookedIt = async (recipe) => {
    if (!userId || !recipe?.id) return false
    const cardId = suggestionCardKey(recipe)
    if (cookInFlightRef.current.has(cardId)) return false

    cookInFlightRef.current.add(cardId)
    syncCookingUi()

    const ingredients = buildCookIngredients(recipe)
    if (ingredients.length === 0 && !isStapleRecipeId(recipe)) {
      setError(OPEN_RECIPE_MESSAGE)
      cookInFlightRef.current.delete(cardId)
      syncCookingUi()
      return false
    }

    const recipeId = recipe.recipeIdForCook || recipe.id
    let hh = householdId
    if (!hh) {
      try {
        const response = await api.getHousehold(userId)
        hh = response.household?.id || null
        if (hh) setHouseholdId(hh)
      } catch {
        /* server cook path also resolves household */
      }
    }
    try {
      const cookResult = await api.markCooked(userId, {
        recipeId,
        recipeName: recipe.title,
        servings: recipe.servings || 4,
        ingredients,
        householdId: hh,
        poolSuggestionId: recipe.pool_suggestion_id || undefined,
      })
      if (!firstCookEmitted.current) {
        firstCookEmitted.current = true
        void emit(FunnelEvent.FIRST_COOK_LOGGED, userId)
      }
      void emitRepeatable(FunnelEvent.COOK_LOGGED, userId, {
        recipeId: String(recipeId),
      })
      setExitConfirmRecipe(null)
      if (cardId) {
        exitConfirmSuppressedRef.current.add(cardId)
      }

      if (recipe.pool_suggestion_id) {
        cookedPoolIdsRef.current.add(recipe.pool_suggestion_id)
        setSuggestions((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            next[key] = next[key].filter(
              (r) => suggestionCardKey(r) !== cardId
            )
          }
          return next
        })
        void maybeTriggerLowWatermarkRefill()
      }

      setCookedConfirmation(cookConfirmationMessage(cookResult?.touched))
      setTimeout(() => setCookedConfirmation(null), 2500)

      const perishableTouched = (cookResult?.touched || []).filter(
        (item) => String(item.depletion_class || '').toUpperCase() === 'PERISHABLE'
      )
      if (perishableTouched.length > 0) {
        setPostCookPerishables(perishableTouched)
      } else {
        setPostCookPerishables([])
        try {
          const hc = await api.getHealthCard(userId, hh)
          if (hc.show && hc.items?.length > 0) {
            setHealthCardItems(hc.items)
            setHealthCardVisible(true)
          }
        } catch {
          /* health card is non-critical */
        }
      }

      const { suggestions: updated } = await fetchSuggestionsPayload(userId, hh)
      setSuggestions(updated)
      void fetchPantry()

      if (isDevCookLoopRecipe(recipe)) {
        void (async () => {
          try {
            let poolPayload = null
            try {
              poolPayload = await api.suggestions.getPool(userId, hh)
            } catch {
              /* pool optional for client check */
            }
            const clientChecks = clientCookLoopChecks(recipe, cookResult, poolPayload)
            const report = await api.devCookLoopReport()
            const merged = {
              ...report,
              client_checks: clientChecks,
              ok: report.ok && clientChecks.every((c) => c.ok),
            }
            stashCookLoopReport(merged)
            postDevLog('cookLoopQa', compactCookLoopQaLog(report, clientChecks))
          } catch (qaErr) {
            console.warn('Cook-loop QA observe failed:', qaErr)
          }
        })()
      }
      return true
    } catch (err) {
      setError(err.response?.data?.error || COOK_PARTIAL_ERROR)
      return false
    } finally {
      cookInFlightRef.current.delete(cardId)
      syncCookingUi()
    }
  }

  const removeCardFromSuggestions = (cardKey) => {
    setSuggestions((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter((r) => suggestionCardKey(r) !== cardKey)
      }
      return next
    })
  }

  const handleDismiss = async (recipe) => {
    const cardKey = suggestionCardKey(recipe)
    if (!cardKey || dismissingCardKeys.has(cardKey)) return

    const snapshot = suggestions
    removeCardFromSuggestions(cardKey)
    setDismissingCardKeys((prev) => new Set(prev).add(cardKey))

    if (
      selectedRecipe &&
      suggestionCardKey(selectedRecipe) === cardKey
    ) {
      setDetailModalOpen(false)
      setSelectedRecipe(null)
      setExitConfirmRecipe(null)
    }

    if (!userId) {
      setDismissingCardKeys((prev) => {
        const next = new Set(prev)
        next.delete(cardKey)
        return next
      })
      return
    }

    try {
      if (recipe.pool_suggestion_id) {
        await api.suggestions.swipe(userId, recipe.pool_suggestion_id, householdId)
        void maybeTriggerLowWatermarkRefill()
      } else {
        await api.dismissSuggestion(userId, recipe.id, householdId)
      }
    } catch (err) {
      console.error('dismiss failed', err)
      const status = err.response?.status
      if (status !== 404) {
        setSuggestions(snapshot)
      }
    } finally {
      setDismissingCardKeys((prev) => {
        const next = new Set(prev)
        next.delete(cardKey)
        return next
      })
    }
  }

  const handleExpand = (recipe) => {
    setSelectedRecipe(recipe)
    setDetailModalOpen(true)
    if (userId) {
      void emitRepeatable(FunnelEvent.RECIPE_DETAIL_OPENED, userId, {
        recipeId: String(recipe.recipeIdForCook || recipe.id || ''),
      })
    }
  }

  const handleDetailClose = (meta) => {
    setDetailModalOpen(false)
    const recipe = meta?.recipe
    const cardKey = recipe ? suggestionCardKey(recipe) : null
    if (
      cardKey &&
      (meta?.viewDurationMs ?? 0) >= EXIT_CONFIRM_VIEW_THRESHOLD_MS &&
      meta?.instructionsReached &&
      !exitConfirmSuppressedRef.current.has(cardKey) &&
      !cookInFlightRef.current.has(cardKey)
    ) {
      setExitConfirmRecipe(recipe)
    } else {
      setExitConfirmRecipe(null)
    }
    setSelectedRecipe(null)
  }

  const dismissExitConfirm = (recipeId) => {
    if (recipeId) {
      exitConfirmSuppressedRef.current.add(recipeId)
    }
    setExitConfirmRecipe(null)
  }

  const renderShelf = (key, title, subtitle, list) => {
    if (!list || list.length === 0) return null
    return (
      <section key={key} className="mb-8">
        <div className="mb-3">
          <h2 className="eyebrow">{title}</h2>
          {subtitle ? <p className="text-sm text-sage-light mt-1">{subtitle}</p> : null}
        </div>
        {list.map((recipe) => {
          const cardKey = suggestionCardKey(recipe)
          return (
            <SuggestionRecipeCard
              key={`${key}-${cardKey}`}
              recipe={recipe}
              tier={key}
              onDismiss={handleDismiss}
              onExpand={handleExpand}
              dismissBusy={dismissingCardKeys.has(cardKey)}
            />
          )
        })}
      </section>
    )
  }

  const cookTonightCap = capCookTonight(
    suggestions.cook_tonight,
    5,
    showMoreCookTonight
  )

  const hasAnyRecipes =
    (suggestions.use_soon_shelf?.length || 0) +
      (suggestions.cook_tonight?.length || 0) +
      (suggestions.probably_have?.length || 0) +
      (suggestions.check_first?.length || 0) >
    0

  const selectedCookBusy = selectedRecipe
    ? cookingRecipeIds.has(suggestionCardKey(selectedRecipe))
    : false

  return (
    <PullToRefresh onRefresh={handleRefreshPull}>
      <div>
        <PageHeader title="Recipe Ideas" />

        <NeedsAttentionSection variant="slim" />

        {cookedConfirmation && (
          <div className="mb-4 p-3 rounded-meald-md bg-forest-light text-cream text-center text-sm border border-forest-light">
            {cookedConfirmation}
          </div>
        )}

        {postCookPerishables.length > 0 && (
          <div className="mb-4 p-4 rounded-meald-md bg-forest-mid border border-sage/30">
            <h3 className="text-sm font-display font-semibold text-cream mb-3">
              Still have these?
            </h3>
            <ul className="space-y-3">
              {postCookPerishables.map((item) => (
                <li key={item.pantry_item_id}>
                  <IngredientCorrection
                    itemId={String(item.pantry_item_id)}
                    ingredientName={item.base_ingredient}
                    showNeverHadIt={false}
                    onCorrection={handlePostCookCorrection}
                    onDismiss={() => {
                      setPostCookPerishables((prev) =>
                        prev.filter(
                          (row) =>
                            String(row.pantry_item_id) !== String(item.pantry_item_id)
                        )
                      )
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 border border-[var(--color-error)] rounded-meald-md text-[var(--color-error)] bg-[var(--color-error)]/10">
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

        {loading ? (
          <div className="card flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terra" />
          </div>
        ) : !hasAnyRecipes ? (
          <div className="card text-center py-12">
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
              "Use before it's gone",
              useSoonShelfSubtitle(suggestions.use_soon_shelf),
              suggestions.use_soon_shelf
            )}
            {renderShelf('cook_tonight', 'Cook tonight', null, cookTonightCap.visible)}
            {!showMoreCookTonight && cookTonightCap.hiddenCount > 0 ? (
              <button
                type="button"
                className="btn-ghost w-full mb-8"
                onClick={() => setShowMoreCookTonight(true)}
              >
                Show more ({cookTonightCap.hiddenCount})
              </button>
            ) : null}
            {renderShelf(
              'probably_have',
              'Probably have everything',
              null,
              suggestions.probably_have
            )}
            {renderShelf('check_first', 'Quick check needed', null, suggestions.check_first)}
          </div>
        )}

        <SuggestionDetailModal
          isOpen={detailModalOpen}
          onClose={handleDetailClose}
          recipe={selectedRecipe}
          loading={false}
          userId={userId}
          pantryData={pantryData}
          cookDisabled={selectedCookBusy}
          cookBusy={selectedCookBusy}
          onCookedIt={async (r) => {
            const ok = await handleCookedIt(r)
            if (ok) {
              handleDetailClose({ recipe: r, viewDurationMs: 0, instructionsReached: false })
            }
          }}
          onIngredientCorrected={() => void loadSuggestions()}
        />

        {exitConfirmRecipe &&
          createPortal(
            <div
              className={`fixed bottom-0 inset-x-0 ${APP_OVERLAY_Z_CLASS} p-4 pb-tab-bar pointer-events-none`}
              data-testid="exit-confirm-overlay"
            >
              <div
                className="max-w-lg mx-auto rounded-meald-md bg-forest-mid border border-sage/30 p-3 flex flex-wrap items-center gap-3 pointer-events-auto shadow-meald-lg"
                role="status"
              >
                <p className="text-sm text-cream flex-1 min-w-[8rem]">Did you cook this?</p>
                <button
                  type="button"
                  className="btn btn-primary text-sm py-2 px-4"
                  onClick={() => void handleCookedIt(exitConfirmRecipe)}
                >
                  Yes, cooked it
                </button>
                <button
                  type="button"
                  className="btn btn-secondary text-sm py-2 px-4"
                  onClick={() => dismissExitConfirm(suggestionCardKey(exitConfirmRecipe))}
                >
                  Not this time
                </button>
              </div>
            </div>,
            document.body
          )}

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
              const { suggestions: updated } = await fetchSuggestionsPayload(
                userId,
                householdId
              )
              setSuggestions(updated)
              await fetchPantry()
            }}
          />
        ) : null}
      </div>
    </PullToRefresh>
  )
}

export default Recipes
