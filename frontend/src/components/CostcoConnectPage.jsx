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
      <div className="surface-light shadow-mise-md p-6 sm:p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-display font-bold text-[var(--on-surface-light)] mb-2">Connect Your Costco Account</h2>
          <p className="text-sm text-[var(--on-surface-light-muted)]">
            Extract two values from your browser&apos;s Network tab to connect.
          </p>
        </div>

        {error && (
          <div className="alert alert-error mb-4" role="alert">
            <p>{error}</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="alert alert-success mb-4">
            <p className="font-semibold">Costco account connected successfully.</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="alert alert-warning mb-4">
            <p className="mb-2">Connection expired. Please generate a new one.</p>
            <button type="button" onClick={generateConnectionCode} className="btn btn-primary">
              Generate New Code
            </button>
          </div>
        )}

        {connectionCode && status === 'pending' && (
          <div className="space-y-6">
            
            {/* Timer */}
            <div className="alert alert-warning flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-medium">Session expires in:</span>
              <span className="text-xl font-mono font-bold text-[var(--on-surface-light)]">{formatTime(timeRemaining)}</span>
            </div>

            {/* Step 1: Open Costco */}
            <div className="alert alert-info">
              <h3 className="text-lg font-display font-semibold text-[var(--on-surface-light)] mb-2">Step 1: Open Costco Orders Page</h3>
              <p className="text-sm text-[var(--on-surface-light-muted)] mb-3">
                Open DevTools (F12) BEFORE clicking, then go to the <strong>Network</strong> tab.
              </p>
              <button type="button" onClick={openCostco} className="btn btn-primary">
                Open Costco Orders Page
              </button>
            </div>

            {/* Step 2: Find the values */}
            <div className="rounded-mise-md border border-[var(--border-default)] bg-[var(--surface-light-elev)] p-4">
              <h3 className="text-lg font-display font-semibold text-[var(--on-surface-light)] mb-3">Step 2: Find These Headers</h3>
              
              <div className="border border-[var(--border-default)] rounded-mise-md p-4 mb-4 bg-[var(--surface-light)]">
                <p className="text-sm text-[var(--on-surface-light-muted)] mb-3">
                  In the <strong>Network</strong> tab, look for any request to <code className="px-1 py-0.5 rounded bg-[var(--surface-light-elev)] text-[13px]">ecom-api.costco.com</code>
                </p>
                <p className="text-sm text-[var(--on-surface-light-muted)] mb-3">
                  Click on it → go to <strong>Headers</strong> tab → scroll to <strong>Request Headers</strong>
                </p>
                
                <div className="space-y-3 mt-4">
                  <div className="flex items-start gap-3 p-3 rounded-mise-sm border-l-4 border-terra bg-[var(--surface-light-elev)]">
                    <span className="font-bold text-terra shrink-0">1.</span>
                    <div>
                      <code className="font-mono text-sm px-2 py-1 rounded-mise-sm bg-forest/10 text-[var(--on-surface-light)]">costco-x-authorization</code>
                      <p className="text-xs text-[var(--on-surface-light-muted)] mt-1">Starts with &quot;Bearer eyJ...&quot; — copy the ENTIRE value</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 rounded-mise-sm border-l-4 border-sage bg-[var(--surface-light-elev)]">
                    <span className="font-bold text-sage shrink-0">2.</span>
                    <div>
                      <code className="font-mono text-sm px-2 py-1 rounded-mise-sm bg-forest/10 text-[var(--on-surface-light)]">client-identifier</code>
                      <p className="text-xs text-[var(--on-surface-light-muted)] mt-1">Looks like: 481b1aec-aa3b-454b-b81b-48187e28f205</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Paste the values */}
            <div className="alert alert-success">
              <h3 className="text-lg font-display font-semibold text-[var(--on-surface-light)] mb-3">Step 3: Paste the Values</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--on-surface-light-mid)] mb-1">
                    costco-x-authorization (Bearer token)
                  </label>
                  <textarea
                    value={idToken}
                    onChange={(e) => setIdToken(e.target.value)}
                    placeholder="Bearer eyJhbGciOiJSUzI1NiIs..."
                    className="input-surface w-full h-20 p-3 rounded-mise-md font-mono text-xs"
                    disabled={submitting}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-[var(--on-surface-light-mid)] mb-1">
                    client-identifier
                  </label>
                  <input
                    type="text"
                    value={clientIdentifier}
                    onChange={(e) => setClientIdentifier(e.target.value)}
                    placeholder="481b1aec-aa3b-454b-b81b-48187e28f205"
                    className="input-surface w-full p-3 rounded-mise-md font-mono text-sm"
                    disabled={submitting}
                  />
                </div>

                <button
                  type="button"
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
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CostcoConnectPage
