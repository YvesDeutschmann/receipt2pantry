import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
import CookPickerDeck from '../components/CookPickerDeck'
import PageHeader from '../components/PageHeader'
import NeedsAttentionSection from '../components/NeedsAttentionSection'
import PullToRefresh from '../components/PullToRefresh'
import { buildCookIngredients, isStapleRecipeId } from '../utils/buildCookIngredients'
import {
  clampDeckIndex,
  computeIndexAfterSkip,
  flattenCookDeck,
  hasAnySuggestions,
  suggestionCardKey,
  whatsForMealTitle,
  windowCookDeck,
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

const POLL_BACKOFF_MS = [500, 1000, 2000, 3000, 4000]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tierToShelfKey(tier) {
  if (tier === 'use_soon') return 'use_soon_shelf'
  if (tier === 'cook_tonight' || tier === 'probably_have' || tier === 'check_first') {
    return tier
  }
  return 'cook_tonight'
}

function reinsertCard(prev, recipe) {
  const shelfKey = tierToShelfKey(recipe.tier)
  const key = suggestionCardKey(recipe)
  if (!key) return prev
  const next = { ...prev }
  const list = next[shelfKey] || []
  if (list.some((r) => suggestionCardKey(r) === key)) return prev
  next[shelfKey] = [...list, recipe]
  return next
}

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
  const [deckIndex, setDeckIndex] = useState(0)
  const [cookingRecipeIds, setCookingRecipeIds] = useState(() => new Set())
  const [dismissingCardKeys, setDismissingCardKeys] = useState(() => new Set())
  const [ptrDisabled, setPtrDisabled] = useState(false)
  const [refreshingEmpty, setRefreshingEmpty] = useState(false)

  const { user } = useAuth()
  const userId = user?.id

  const initialLoadDoneRef = useRef(false)
  const firstSuggestionEmitted = useRef(false)
  const firstCookEmitted = useRef(false)
  const cookInFlightRef = useRef(new Set())
  const skipInFlightRef = useRef(new Set())
  const cookedPoolIdsRef = useRef(new Set())
  const exitConfirmSuppressedRef = useRef(new Set())
  const frozenHourRef = useRef(new Date().getHours())
  const loadEpochRef = useRef(0)
  const generatePromiseRef = useRef(null)

  const syncCookingUi = useCallback(() => {
    setCookingRecipeIds(new Set(cookInFlightRef.current))
  }, [])

  const flattened = useMemo(
    () => flattenCookDeck(suggestions, frozenHourRef.current),
    [suggestions]
  )

  const visibleDeck = useMemo(() => windowCookDeck(flattened, 8), [flattened])

  useEffect(() => {
    setDeckIndex((idx) => clampDeckIndex(idx, visibleDeck.length))
  }, [visibleDeck.length])

  useEffect(() => {
    cookedPoolIdsRef.current = new Set()
    exitConfirmSuppressedRef.current = new Set()
    firstSuggestionEmitted.current = false
    cookInFlightRef.current = new Set()
    skipInFlightRef.current = new Set()
    loadEpochRef.current += 1
    setDeckIndex(0)
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

  const applySuggestions = useCallback(
    (next, { resetIndex = false } = {}) => {
      setSuggestions(next)
      if (resetIndex) {
        setDeckIndex(0)
      }
    },
    []
  )

  const loadSuggestions = useCallback(
    async ({ resetIndex = false, epoch } = {}) => {
      if (!userId) return null
      const myEpoch = epoch ?? loadEpochRef.current
      if (!initialLoadDoneRef.current) {
        setLoading(true)
      }
      setError(null)
      try {
        frozenHourRef.current = new Date().getHours()
        const { suggestions: next } = await fetchSuggestionsPayload(userId, householdId)
        if (myEpoch !== loadEpochRef.current) return null
        initialLoadDoneRef.current = true
        applySuggestions(next, { resetIndex })
        if (hasAnySuggestions(next) && !firstSuggestionEmitted.current) {
          firstSuggestionEmitted.current = true
          void emit(FunnelEvent.FIRST_SUGGESTION_VIEWED, userId)
        }
        return next
      } catch (err) {
        if (myEpoch !== loadEpochRef.current) return null
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
        applySuggestions(EMPTY_SUGGESTIONS, { resetIndex })
        return null
      } finally {
        if (myEpoch === loadEpochRef.current) {
          setLoading(false)
        }
      }
    },
    [userId, householdId, applySuggestions]
  )

  const pollUntilSuggestions = useCallback(
    async (epoch) => {
      for (const delay of POLL_BACKOFF_MS) {
        await sleep(delay)
        if (epoch !== loadEpochRef.current) return null
        const next = await loadSuggestions({ epoch })
        if (next && flattenCookDeck(next, frozenHourRef.current).length > 0) {
          return next
        }
      }
      return null
    },
    [loadSuggestions]
  )

  const generateThenReload = useCallback(
    async ({ triggerReason = 'manual_refresh' }) => {
      if (!userId) return null
      if (generatePromiseRef.current) {
        return generatePromiseRef.current
      }

      const epoch = loadEpochRef.current
      const promise = (async () => {
        try {
          let genResult = null
          try {
            genResult = await api.suggestions.triggerGeneration(userId, {
              triggerReason,
              householdId,
            })
          } catch (err) {
            const status = err.response?.status
            if (status === 429 || err.response?.data?.code === 'recipe_quota') {
              setError(
                err.response?.data?.error ||
                  'Daily recipe lookup limit reached. Suggestions will refresh tomorrow.'
              )
            }
            await loadSuggestions({ resetIndex: true, epoch })
            return null
          }

          if (epoch !== loadEpochRef.current) return null

          if (genResult?.status === 'already_running') {
            const polled = await pollUntilSuggestions(epoch)
            if (polled) return polled
          }

          return await loadSuggestions({ resetIndex: true, epoch })
        } finally {
          generatePromiseRef.current = null
        }
      })()

      generatePromiseRef.current = promise
      return promise
    },
    [userId, householdId, loadSuggestions, pollUntilSuggestions]
  )

  const maybeTriggerLowWatermarkRefill = useCallback(async () => {
    if (!userId) return
    try {
      const res = await api.suggestions.getDepth(userId, householdId)
      const depth = res.depth || {}
      const slots = ['breakfast', 'lunch', 'dinner']
      const anyLow = slots.some((k) => (depth[k] ?? 0) < 2)
      if (anyLow) {
        void generateThenReload({ triggerReason: 'low_watermark' })
      }
    } catch (e) {
      console.warn('Low-watermark check failed:', e)
    }
  }, [userId, householdId, generateThenReload])

  useEffect(() => {
    void fetchHousehold()
  }, [fetchHousehold])

  useEffect(() => {
    if (!userId) return
    void loadSuggestions({ resetIndex: true })
    void fetchPantry()
  }, [userId, householdId, loadSuggestions, fetchPantry])

  const handleRefreshPull = async () => {
    await generateThenReload({ triggerReason: 'manual_refresh' })
  }

  const handleEmptyRefresh = async () => {
    setRefreshingEmpty(true)
    try {
      await generateThenReload({ triggerReason: 'manual_refresh' })
    } finally {
      setRefreshingEmpty(false)
    }
  }

  const handlePostCookCorrection = async (itemId, action) => {
    if (!userId) return
    await api.correctPantryItem(userId, itemId, action)
    setPostCookPerishables((prev) =>
      prev.filter((item) => String(item.pantry_item_id) !== String(itemId))
    )
    if (action === 'used_it_up' || action === 'never_had_it') {
      await generateThenReload({ triggerReason: 'manual_refresh' })
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
      frozenHourRef.current = new Date().getHours()
      applySuggestions(updated, { resetIndex: false })
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
    if (!cardKey || skipInFlightRef.current.has(cardKey)) return

    const hour = frozenHourRef.current
    const flatBefore = flattenCookDeck(suggestions, hour)
    const windowBefore = windowCookDeck(flatBefore, 8)
    const nextKey =
      deckIndex + 1 < windowBefore.length
        ? suggestionCardKey(windowBefore[deckIndex + 1])
        : null

    const flatAfterRemove = flatBefore.filter((r) => suggestionCardKey(r) !== cardKey)
    const willBeEmpty = flatAfterRemove.length === 0

    skipInFlightRef.current.add(cardKey)
    setDismissingCardKeys((prev) => new Set(prev).add(cardKey))
    removeCardFromSuggestions(cardKey)

    if (
      selectedRecipe &&
      suggestionCardKey(selectedRecipe) === cardKey
    ) {
      setDetailModalOpen(false)
      setSelectedRecipe(null)
      setExitConfirmRecipe(null)
    }

    const newVisible = windowCookDeck(flatAfterRemove, 8)
    setDeckIndex(computeIndexAfterSkip({ index: deckIndex, nextKey, newVisible }))

    if (!userId) {
      skipInFlightRef.current.delete(cardKey)
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
      } else {
        await api.dismissSuggestion(userId, recipe.id, householdId)
      }

      if (willBeEmpty) {
        await generateThenReload({ triggerReason: 'low_watermark' })
      }
    } catch (err) {
      console.error('dismiss failed', err)
      const status = err.response?.status
      if (status !== 404) {
        setSuggestions((prev) => reinsertCard(prev, recipe))
      }
    } finally {
      skipInFlightRef.current.delete(cardKey)
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

  const handleDeckIndexChange = (nextIndex) => {
    if (detailModalOpen) {
      setDetailModalOpen(false)
      setSelectedRecipe(null)
      setExitConfirmRecipe(null)
    }
    setDeckIndex(nextIndex)
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

  const hasRecipes = flattened.length > 0

  const selectedCookBusy = selectedRecipe
    ? cookingRecipeIds.has(suggestionCardKey(selectedRecipe))
    : false

  const pageTitle = whatsForMealTitle(frozenHourRef.current)

  return (
    <PullToRefresh onRefresh={handleRefreshPull} disabled={ptrDisabled}>
      <div className="flex flex-col min-h-[calc(100dvh-8rem)] lg:min-h-0">
        <PageHeader title={pageTitle} sticky={false} />

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
        ) : !hasRecipes ? (
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
            <button
              type="button"
              className="btn btn-primary"
              disabled={refreshingEmpty}
              onClick={() => void handleEmptyRefresh()}
            >
              {refreshingEmpty ? 'Refreshing…' : 'Refresh suggestions'}
            </button>
          </div>
        ) : (
          <CookPickerDeck
            visible={visibleDeck}
            index={deckIndex}
            onIndexChange={handleDeckIndexChange}
            onDismiss={handleDismiss}
            onDetails={handleExpand}
            dismissBusyKeys={dismissingCardKeys}
            onHorizontalDragChange={setPtrDisabled}
          />
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
              frozenHourRef.current = new Date().getHours()
              applySuggestions(updated)
              await fetchPantry()
            }}
          />
        ) : null}
      </div>
    </PullToRefresh>
  )
}

export default Recipes
