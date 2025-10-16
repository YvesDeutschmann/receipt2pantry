import axios from 'axios'

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  timeout: 30000,
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

  testProviderConnection: async (providerName, username, password) => {
    const response = await apiClient.post(`/providers/${providerName}/test`, {
      username,
      password
    })
    return response.data
  },
}

export default apiClient

