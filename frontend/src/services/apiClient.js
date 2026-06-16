import axios from 'axios'
import { Preferences } from '@capacitor/preferences'
import { supabase } from './supabaseClient'

const PREF_MANUAL = 'dev_api_base_url'
const PREF_SYNCED = 'dev_api_base_url_synced'
const SUPABASE_CONFIG_KEY = 'dev_api_base_url'

let manualOverride = null
let syncedValue = null
let initPromise = null

/** Normalize user/pasted URL to API base (…/api, no trailing slash). */
export function normalizeApiBaseUrl(url) {
  const t = (url || '').trim().replace(/\/+$/, '')
  if (!t) return ''
  return /\/api$/.test(t) ? t : `${t}/api`
}

function getInitialBaseURL() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }
  const hostname = typeof window !== 'undefined' ? (window.location.hostname || 'localhost') : 'localhost'
  return `http://${hostname}:5000/api`
}

export async function initApiBaseUrl() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const [{ value: m }, { value: s }] = await Promise.all([
        Preferences.get({ key: PREF_MANUAL }),
        Preferences.get({ key: PREF_SYNCED }),
      ])
      manualOverride = m || null
      syncedValue = s || null
    } catch {
      manualOverride = null
      syncedValue = null
    }
  })()
  return initPromise
}

export function shouldSyncApiBaseFromSupabase() {
  return true
}

export async function refreshSyncedApiBaseUrl() {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', SUPABASE_CONFIG_KEY)
      .maybeSingle()

    if (error) return { ok: false, error: error.message }

    const next = normalizeApiBaseUrl(data?.value)

    if (!next) {
      const had = !!syncedValue
      if (had) {
        try {
          await Preferences.remove({ key: PREF_SYNCED })
        } catch {
          /* ignore */
        }
        syncedValue = null
      }
      return { ok: true, changed: had, value: null }
    }

    if (next !== syncedValue) {
      try {
        await Preferences.set({ key: PREF_SYNCED, value: next })
      } catch {
        syncedValue = next
        return { ok: true, changed: true, value: next }
      }
      syncedValue = next
      return { ok: true, changed: true, value: next }
    }

    return { ok: true, changed: false, value: syncedValue }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function setApiBaseUrlOverride(url) {
  const normalized = normalizeApiBaseUrl(url)
  if (normalized) {
    await Preferences.set({ key: PREF_MANUAL, value: normalized })
    manualOverride = normalized
  } else {
    await Preferences.remove({ key: PREF_MANUAL })
    manualOverride = null
  }
}

export function getEffectiveApiBaseUrl() {
  if (manualOverride) return { url: manualOverride, source: 'override' }
  if (syncedValue) return { url: syncedValue, source: 'supabase' }
  if (import.meta.env.VITE_API_BASE_URL) {
    return { url: import.meta.env.VITE_API_BASE_URL, source: 'build' }
  }
  const hostname = typeof window !== 'undefined' ? (window.location.hostname || 'localhost') : 'localhost'
  return { url: `http://${hostname}:5000/api`, source: 'auto' }
}

/** For dev UI: current resolution including raw stored values. */
export function getApiBaseResolutionDebug() {
  const eff = getEffectiveApiBaseUrl()
  return {
    ...eff,
    manualStored: manualOverride,
    syncedStored: syncedValue,
  }
}

const API_CLIENT_DEV_LOG_MAX = 2000

/** Best-effort POST to backend /dev/log (same contract as webViewBridge.bridgeDevLog). */
export function postDevLog(tag, msg) {
  try {
    const base = getEffectiveApiBaseUrl().url.replace(/\/+$/, '')
    const url = `${base}/dev/log`
    const safeTag = String(tag || 'apiClient').replace(/\s+/g, '_').slice(0, 64)
    let safeMsg = String(msg ?? '')
    if (safeMsg.length > API_CLIENT_DEV_LOG_MAX) {
      safeMsg = safeMsg.slice(0, API_CLIENT_DEV_LOG_MAX) + '…'
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: `${safeTag}|${safeMsg}`,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

// Create axios instance with default config (baseURL updated per request after Preferences init)
const apiClient = axios.create({
  baseURL: getInitialBaseURL(),
  timeout: 120000, // 2 minutes timeout for device verification
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
})

// Request interceptor: resolve API base URL, add Supabase JWT and X-User-Id from session
apiClient.interceptors.request.use(
  async (config) => {
    await initApiBaseUrl()
    config.baseURL = getEffectiveApiBaseUrl().url
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`
    }
    if (session?.user?.id) {
      config.headers['X-User-Id'] = session.user.id
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with error status
      const message = error.response.data?.error || 'An error occurred'
      console.error('API Error:', message)
      const cfg = error.config || {}
      const method = (cfg.method || 'get').toUpperCase()
      const fullUrl = `${cfg.baseURL || ''}${cfg.url || ''}`
      let bodyPreview = ''
      try {
        const d = error.response.data
        bodyPreview =
          typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d).slice(0, 200)
      } catch {
        bodyPreview = ''
      }
      let resolution = ''
      try {
        resolution = JSON.stringify(getApiBaseResolutionDebug())
      } catch {
        resolution = '{}'
      }
      postDevLog(
        'apiClient',
        `axios ${method} ${fullUrl} status=${error.response.status} bodyPreview=${bodyPreview} resolution=${resolution}`
      )
    } else if (error.request) {
      // Request made but no response
      console.error('Network Error:', error.message)
    } else {
      // Something else happened
      console.error('Error:', error.message)
    }
    return Promise.reject(error)
  }
)

// API methods
export const api = {
  // Health check
  healthCheck: async () => {
    const response = await apiClient.get('/health')
    return response.data
  },

  // Receipts
  getReceipts: async (userId, limit = 50) => {
    const response = await apiClient.get('/receipts', {
      params: { user_id: userId, limit }
    })
    return response.data
  },

  parseReceipt: async (provider, emailContent) => {
    const response = await apiClient.post('/receipts/parse', {
      provider,
      email_content: emailContent
    })
    return response.data
  },

  // Providers
  listProviders: async () => {
    const response = await apiClient.get('/providers')
    return response.data
  },

  getProviderStatus: async (providerName, userId) => {
    const response = await apiClient.get(`/providers/${providerName}/status`, {
      params: { user_id: userId }
    })
    return response.data
  },

  fetchReceiptsWithStoredCredentials: async (providerName, userId, days = 90) => {
    const response = await apiClient.post(`/providers/${providerName}/fetch-receipts`, {
      user_id: userId,
      days
    })
    return response.data
  },

  // Token-Based Connection (Generic for providers like Costco)
  getConnectionCode: async (provider, userId) => {
    const response = await apiClient.get(`/providers/${provider}/connection-code`, {
      params: { user_id: userId }
    })
    return response.data
  },

  connectProvider: async (provider, tokenData) => {
    const response = await apiClient.post(`/providers/${provider}/connect`, tokenData)
    return response.data
  },

  connectCostcoFromApp: async (userId, tokens) => {
    const response = await apiClient.post('/providers/costco/connect-from-app', {
      user_id: userId,
      idToken: tokens.idToken || tokens.accessToken,
      clientId: tokens.clientID,
      wcsClientId: tokens.wcsClientId,
      refreshToken: tokens.refreshToken || null,
      refreshTokenClientId: tokens.refreshTokenClientId || null,
    })
    return response.data
  },

  /** Store pre-fetched Costco receipts from One-Tap Sync (in-WebView fetch). */
  storeCostcoReceipts: async (receipts, userId) => {
    const response = await apiClient.post('/providers/costco/store-receipts', {
      receipts,
      user_id: userId,
    })
    return response.data
  },

  /** Ingest receipts from native WebView bridge (Safeway, Costco, etc.). */
  ingestReceipts: async (provider, receipts, userId) => {
    const response = await apiClient.post('/receipts/ingest', {
      provider,
      receipts,
      user_id: userId,
    })
    return response.data
  },

  getConnectionStatus: async (provider, connectionCode) => {
    const response = await apiClient.get(`/providers/${provider}/connection/${connectionCode}/status`)
    return response.data
  },

  // Legacy Costco methods (for backward compatibility)
  getCostcoConnectionCode: async (userId) => {
    return api.getConnectionCode('costco', userId)
  },

  connectCostcoWithTokens: async (connectionCode, tokens) => {
    return api.connectProvider('costco', { connection_code: connectionCode, ...tokens })
  },

  getCostcoConnectionStatus: async (connectionCode) => {
    return api.getConnectionStatus('costco', connectionCode)
  },

  // Household Management
  getHousehold: async (userId) => {
    const response = await apiClient.get('/households', {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  createHousehold: async (userId, name, size = 2, dietaryRestrictions = []) => {
    const response = await apiClient.post('/households',
      { name, size, dietary_restrictions: dietaryRestrictions },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  updateHouseholdProfile: async (userId, { size, dietaryRestrictions, suggestionMealSlots }) => {
    const body = {}
    if (size !== undefined) body.size = size
    if (dietaryRestrictions !== undefined) body.dietary_restrictions = dietaryRestrictions
    if (suggestionMealSlots !== undefined) body.suggestion_meal_slots = suggestionMealSlots
    const response = await apiClient.put('/households/profile', body, {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  joinHousehold: async (userId, joinCode) => {
    const response = await apiClient.post('/households/join',
      { join_code: joinCode },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  leaveHousehold: async (userId) => {
    const response = await apiClient.post('/households/leave',
      {},
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  getHouseholdMembers: async (userId) => {
    const response = await apiClient.get('/households/members', {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  regenerateJoinCode: async (userId) => {
    const response = await apiClient.post('/households/code',
      {},
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  updateHouseholdName: async (userId, name) => {
    const response = await apiClient.put('/households/name',
      { name },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  removeMember: async (userId, memberUserId) => {
    const response = await apiClient.delete(`/households/members/${memberUserId}`, {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  /** Dev only: backend must run with DEBUG=true */
  devResetOnboarding: async () => {
    const response = await apiClient.delete('/dev/reset-onboarding')
    return response.data
  },

  /** Dev only: load data/fixtures into DB via the real ingest + pantry pipeline */
  devLoadMockReceipts: async (provider = 'all', options = {}) => {
    const { reset = false } = options
    const response = await apiClient.post('/dev/load-mock-receipts', {
      provider,
      reset,
    })
    return response.data
  },

  // Pantry Management
  getPantry: async (userId, householdId = null) => {
    const params = householdId ? { household_id: householdId } : {}
    const response = await apiClient.get('/pantry', {
      params,
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  addPantryItem: async (userId, item) => {
    const response = await apiClient.post('/pantry/items',
      item,
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  updatePantryItem: async (userId, itemId, quantity) => {
    const response = await apiClient.put(`/pantry/items/${itemId}`,
      { quantity },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  deletePantryItem: async (userId, itemId) => {
    const response = await apiClient.delete(`/pantry/items/${itemId}`, {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  getStaplesTemplate: async () => {
    const response = await apiClient.get('/pantry/staples-template')
    return response.data
  },

  getStaplesReceiptMatches: async () => {
    const response = await apiClient.get('/pantry/staples-receipt-matches')
    return response.data
  },

  confirmStaples: async (userId, selectedItems, _skipped = false) => {
    const response = await apiClient.post(
      '/pantry/confirm-staples',
      { selected_items: selectedItems },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  searchIngredients: async (query, exclude = [], limit = 6) => {
    const params = { q: query, limit }
    if (exclude.length > 0) {
      params.exclude = exclude.join(',')
    }
    const response = await apiClient.get('/pantry/search-ingredients', { params })
    return response.data
  },

  quickAddPantryItem: async (userId, baseIngredient) => {
    const response = await apiClient.post(
      '/pantry/quick-add',
      { base_ingredient: baseIngredient },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  depletePantryItem: async (userId, itemId) => {
    const response = await apiClient.post(
      `/pantry/items/${itemId}/deplete`,
      {},
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  restorePantryItem: async (userId, snapshot) => {
    const response = await apiClient.post(
      '/pantry/restore-item',
      { snapshot },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  voiceTranscribe: async (audioBlob) => {
    const formData = new FormData()
    const ext = audioBlob?.type?.includes('mp4') ? 'mp4' : 'webm'
    formData.append('audio', audioBlob, `recording.${ext}`)
    const response = await apiClient.post('/pantry/voice-transcribe', formData, {
      timeout: 90000,
      transformRequest: (data, headers) => {
        if (data instanceof FormData) {
          delete headers['Content-Type']
        }
        return data
      },
    })
    return response.data
  },

  voiceConfirm: async (userId, items) => {
    const response = await apiClient.post(
      '/pantry/voice-confirm',
      { items },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  getSuggestions: async (userId, householdId = null) => {
    const params = householdId ? { household_id: householdId } : {}
    const response = await apiClient.get('/suggestions', {
      params,
      headers: { 'X-User-Id': userId },
    })
    return response.data
  },

  dismissSuggestion: async (userId, recipeId, householdId = null) => {
    const response = await apiClient.post(
      '/suggestions/dismiss',
      { recipe_id: recipeId, household_id: householdId },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  markCooked: async (userId, { recipeId, recipeName, servings, ingredients, householdId }) => {
    const response = await apiClient.post(
      '/pantry/cook',
      {
        recipe_id: recipeId,
        recipe_name: recipeName,
        servings,
        ingredients,
        household_id: householdId,
      },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  correctPantryItem: async (userId, itemId, action) => {
    const response = await apiClient.post(
      `/pantry/items/${itemId}/correction`,
      { action },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  getGraveyard: async (userId, householdId = null) => {
    const params = householdId ? { household_id: householdId } : {}
    const response = await apiClient.get('/pantry/graveyard', {
      params,
      headers: { 'X-User-Id': userId },
    })
    return response.data
  },

  putBack: async (userId, depletionHistoryId) => {
    const response = await apiClient.post(
      '/pantry/put-back',
      { depletion_history_id: depletionHistoryId },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  getHealthCard: async (userId, householdId = null) => {
    const params = householdId ? { household_id: householdId } : {}
    const response = await apiClient.get('/pantry/health-card', {
      params,
      headers: { 'X-User-Id': userId },
    })
    return response.data
  },

  dismissHealthCard: async (userId) => {
    const response = await apiClient.post(
      '/pantry/health-card/dismiss',
      {},
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  consumeIngredients: async (userId, recipeData) => {
    const response = await apiClient.post('/pantry/consume',
      recipeData,
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  checkRecipeAvailability: async (userId, ingredients, householdId = null) => {
    const response = await apiClient.post('/pantry/check-recipe',
      { ingredients, household_id: householdId },
      { headers: { 'X-User-Id': userId } }
    )
    return response.data
  },

  // Recipes
  getRecipes: async (userId, householdId = null) => {
    const params = householdId ? { household_id: householdId } : {}
    const response = await apiClient.get('/recipes', {
      params,
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  getRecipeDetails: async (userId, recipeId) => {
    const response = await apiClient.get(`/recipes/${recipeId}`, {
      headers: { 'X-User-Id': userId }
    })
    return response.data
  },

  /** Pre-generated suggestion pool (Spoonacular work done in background). */
  suggestions: {
    getPool: async (userId, householdId = null) => {
      const params = {}
      if (householdId) params.household_id = householdId
      const response = await apiClient.get('/suggestions/pool', {
        params,
        headers: { 'X-User-Id': userId }
      })
      return response.data
    },
    getDepth: async (userId, householdId = null) => {
      const params = {}
      if (householdId) params.household_id = householdId
      const response = await apiClient.get('/suggestions/pool/depth', {
        params,
        headers: { 'X-User-Id': userId }
      })
      return response.data
    },
    swipe: async (userId, suggestionId, householdId = null) => {
      const response = await apiClient.post(
        `/suggestions/pool/${suggestionId}/swipe`,
        { household_id: householdId },
        { headers: { 'X-User-Id': userId } }
      )
      return response.data
    },
    triggerGeneration: async (userId, { triggerReason, householdId = null, mealTypes = null }) => {
      const body = { trigger_reason: triggerReason }
      if (householdId) body.household_id = householdId
      if (mealTypes?.length) body.meal_types = mealTypes
      const response = await apiClient.post('/suggestions/pool/generate', body, {
        headers: { 'X-User-Id': userId },
        timeout: 600000
      })
      return response.data
    }
  },

  // Meal Planning
  mealPlan: {
    startWizard: async (userId, data) => {
      const response = await apiClient.post('/meal-plan/wizard/start', data, {
        headers: { 'X-User-Id': userId }
      })
      return response.data
    },

    getSuggestions: async (sessionId, mealType, threshold = 0.9) => {
      const response = await apiClient.get(
        `/meal-plan/wizard/${sessionId}/suggestions`,
        { params: { meal_type: mealType, threshold } }
      )
      return response.data
    },

    acceptRecipe: async (sessionId, data) => {
      const response = await apiClient.post(
        `/meal-plan/wizard/${sessionId}/accept`,
        data
      )
      return response.data
    },

    softRejectRecipe: async (sessionId, recipeId) => {
      const response = await apiClient.post(
        `/meal-plan/wizard/${sessionId}/soft-reject`,
        { recipe_id: recipeId }
      )
      return response.data
    },

    banRecipe: async (sessionId, recipeId, recipeName, userId) => {
      const response = await apiClient.post(
        `/meal-plan/wizard/${sessionId}/ban`,
        { recipe_id: recipeId, recipe_name: recipeName },
        { headers: { 'X-User-Id': userId } }
      )
      return response.data
    },

    unbanRecipe: async (sessionId, recipeId, userId) => {
      const response = await apiClient.delete(
        `/meal-plan/wizard/${sessionId}/ban/${recipeId}`,
        { headers: { 'X-User-Id': userId } }
      )
      return response.data
    },

    markLeftover: async (sessionId, data) => {
      const response = await apiClient.post(
        `/meal-plan/wizard/${sessionId}/mark-leftover`,
        data
      )
      return response.data
    },

    completeWizard: async (sessionId) => {
      const response = await apiClient.post(
        `/meal-plan/wizard/${sessionId}/complete`
      )
      return response.data
    },

    getMealPlan: async (userId, startDate, endDate, householdId = null) => {
      const params = {
        start_date: startDate,
        end_date: endDate
      }
      if (householdId) params.household_id = householdId
      const response = await apiClient.get('/meal-plan', {
        params,
        headers: { 'X-User-Id': userId }
      })
      return response.data
    },

    updateMeal: async (mealId, updates) => {
      const response = await apiClient.patch(`/meal-plan/${mealId}`, updates)
      return response.data
    },

    deleteMeal: async (mealId) => {
      await apiClient.delete(`/meal-plan/${mealId}`)
    },

    swapMeals: async (mealId1, mealId2) => {
      const response = await apiClient.post(
        `/meal-plan/${mealId1}/swap/${mealId2}`
      )
      return response.data
    }
  },

  // Shopping List
  shoppingList: {
    get: async (userId, includePurchased = false, householdId = null) => {
      const params = { include_purchased: includePurchased }
      if (householdId) params.household_id = householdId
      const response = await apiClient.get('/shopping-list', {
        params,
        headers: { 'X-User-Id': userId }
      })
      return response.data
    },

    markPurchased: async (itemId) => {
      const response = await apiClient.post(
        `/shopping-list/${itemId}/purchased`
      )
      return response.data
    }
  },
}

export default apiClient