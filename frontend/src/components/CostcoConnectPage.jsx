import { useState, useEffect, useRef } from 'react'
import { api } from '../services/apiClient'

function CostcoConnectPage({ userId, onSuccess, onCancel }) {
  const [connectionCode, setConnectionCode] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [timeRemaining, setTimeRemaining] = useState(600)
  const [status, setStatus] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  
  // Two simple input fields
  const [idToken, setIdToken] = useState('')
  const [clientIdentifier, setClientIdentifier] = useState('')
  
  const countdownIntervalRef = useRef(null)

  // Generate connection code on mount
  useEffect(() => {
    generateConnectionCode()
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return
    countdownIntervalRef.current = setInterval(() => {
      const now = new Date()
      const expiry = new Date(expiresAt)
      const remaining = Math.max(0, Math.floor((expiry - now) / 1000))
      setTimeRemaining(remaining)
      if (remaining === 0) {
        setStatus('expired')
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      }
    }, 1000)
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [expiresAt])

  const generateConnectionCode = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getConnectionCode('costco', userId)
      setConnectionCode(data.connection_code)
      setExpiresAt(data.expires_at)
      setTimeRemaining(data.expires_in_seconds)
      setStatus('pending')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate connection code')
    } finally {
      setLoading(false)
    }
  }

  const submitTokens = async () => {
    // Validate
    if (!idToken.trim()) {
      setError('Please enter the idToken (costco-x-authorization header)')
      return
    }
    if (!clientIdentifier.trim()) {
      setError('Please enter the client-identifier')
      return
    }
    
    try {
      setSubmitting(true)
      setError(null)
      
      // Clean the token (remove "Bearer " prefix if present)
      let cleanToken = idToken.trim()
      if (cleanToken.toLowerCase().startsWith('bearer ')) {
        cleanToken = cleanToken.substring(7)
      }
      
      const data = {
        connection_code: connectionCode,
        idToken: cleanToken,
        clientIdentifier: clientIdentifier.trim(),
        // These are optional - we can try to use the token for refresh later
        refreshToken: null,
        refreshTokenClientId: null
      }
      
      const response = await api.connectProvider('costco', data)
      
      if (response.status === 'success') {
        setStatus('connected')
        await new Promise(resolve => setTimeout(resolve, 500))
        if (onSuccess) onSuccess()
      } else {
        throw new Error(response.error || 'Failed to connect')
      }
    } catch (error) {
      setError(error.response?.data?.error || error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openCostco = () => {
    window.open('https://www.costco.com/myaccount/#/app/4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf/ordersandpurchases', '_blank')
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="card">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Connect Your Costco Account</h2>
          <p className="text-gray-600">
            Extract two values from your browser's Network tab to connect.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-600 font-semibold">✓ Costco account connected successfully!</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-600 mb-2">Connection expired. Please generate a new one.</p>
            <button onClick={generateConnectionCode} className="btn btn-primary">
              Generate New Code
            </button>
          </div>
        )}

        {connectionCode && status === 'pending' && (
          <div className="space-y-6">
            
            {/* Timer */}
            <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <span className="text-gray-700">Session expires in:</span>
              <span className="text-xl font-bold text-yellow-600">{formatTime(timeRemaining)}</span>
            </div>

            {/* Step 1: Open Costco */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 1: Open Costco Orders Page</h3>
              <p className="text-gray-600 mb-3 text-sm">
                Open DevTools (F12) BEFORE clicking, then go to the <strong>Network</strong> tab.
              </p>
              <button onClick={openCostco} className="btn btn-primary">
                Open Costco Orders Page
              </button>
            </div>

            {/* Step 2: Find the values */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Step 2: Find These Headers</h3>
              
              <div className="bg-white border rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-3">
                  In the <strong>Network</strong> tab, look for any request to <code className="bg-gray-100 px-1 rounded">ecom-api.costco.com</code>
                </p>
                <p className="text-sm text-gray-600 mb-3">
                  Click on it → go to <strong>Headers</strong> tab → scroll to <strong>Request Headers</strong>
                </p>
                
                <div className="space-y-3 mt-4">
                  <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded">
                    <span className="text-blue-600 font-bold">1.</span>
                    <div>
                      <code className="font-mono text-sm bg-blue-100 px-2 py-1 rounded">costco-x-authorization</code>
                      <p className="text-xs text-gray-500 mt-1">Starts with "Bearer eyJ..." - copy the ENTIRE value</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3 p-3 bg-green-50 rounded">
                    <span className="text-green-600 font-bold">2.</span>
                    <div>
                      <code className="font-mono text-sm bg-green-100 px-2 py-1 rounded">client-identifier</code>
                      <p className="text-xs text-gray-500 mt-1">Looks like: 481b1aec-aa3b-454b-b81b-48187e28f205</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Paste the values */}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Step 3: Paste the Values</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    costco-x-authorization (Bearer token)
                  </label>
                  <textarea
                    value={idToken}
                    onChange={(e) => setIdToken(e.target.value)}
                    placeholder="Bearer eyJhbGciOiJSUzI1NiIs..."
                    className="w-full h-20 p-3 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-green-500"
                    disabled={submitting}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    client-identifier
                  </label>
                  <input
                    type="text"
                    value={clientIdentifier}
                    onChange={(e) => setClientIdentifier(e.target.value)}
                    placeholder="481b1aec-aa3b-454b-b81b-48187e28f205"
                    className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-green-500"
                    disabled={submitting}
                  />
                </div>

                <button
                  onClick={submitTokens}
                  disabled={submitting || !idToken.trim() || !clientIdentifier.trim()}
                  className="btn btn-primary w-full"
                >
                  {submitting ? 'Connecting...' : 'Connect Costco Account'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-3 mt-6">
          {onCancel && (
            <button onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CostcoConnectPage
