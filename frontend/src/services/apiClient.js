import axios from 'axios'
import { supabase } from './supabaseClient'

function getApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }
  // Derive from current hostname so mobile devices (Capacitor) reach the
  // dev machine instead of trying localhost on the phone itself.
  const hostname = window.location.hostname || 'localhost'
  return `http://${hostname}:5000/api`
}

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 120000, // 2 minutes timeout for device verification
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: add Supabase JWT and X-User-Id from session
apiClient.interceptors.request.use(
  async (config) => {
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

  testProviderConnection: async (providerName, username, password, userId = 'anonymous') => {
    const response = await apiClient.post(`/providers/${providerName}/test`, {
      username,
      password,
      user_id: userId
    })
    return response.data
  },

  // Device Verification Methods
  getDeviceVerificationOptions: async (providerName, sessionId) => {
    const response = await apiClient.get(
      `/providers/${providerName}/login/${sessionId}/device-verification`
    )
    return response.data
  },

  selectDeviceVerificationMethod: async (providerName, sessionId, method) => {
    const response = await apiClient.post(
      `/providers/${providerName}/login/${sessionId}/device-verification`,
      { method }
    )
    return response.data
  },

  // MFA Methods
  submitMfaCode: async (providerName, sessionId, code) => {
    const response = await apiClient.post(
      `/providers/${providerName}/login/${sessionId}/mfa`,
      { code }
    )
    return response.data
  },

  getLoginStatus: async (providerName, sessionId) => {
    const response = await apiClient.get(
      `/providers/${providerName}/login/${sessionId}/status`
    )
    return response.data
  },

  cancelLoginSession: async (providerName, sessionId) => {
    await apiClient.delete(`/providers/${providerName}/login/${sessionId}`)
  },

  // Receipt Fetching
  fetchReceipts: async (providerName, username, password, days = 14, userId = 'anonymous') => {
    const body = { username, password, days, user_id: userId }
    const response = await apiClient.post(`/providers/${providerName}/fetch-receipts`, body)
    return response.data
  },

  fetchReceiptsAfterMfa: async (providerName, sessionId, days = 14) => {
    const response = await apiClient.post(
      `/providers/${providerName}/login/${sessionId}/fetch-receipts`,
      { days }
    )
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

  createHousehold: async (userId, name) => {
    const response = await apiClient.post('/households', 
      { name },
      { headers: { 'X-User-Id': userId } }
    )
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

