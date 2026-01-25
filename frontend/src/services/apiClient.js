import axios from 'axios'

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  timeout: 120000, // 2 minutes timeout for device verification
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor for adding auth tokens
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
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
}

export default apiClient

