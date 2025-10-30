import { useState, useEffect, useRef } from 'react'
import { api } from '../services/apiClient'
import ProviderCard from '../components/ProviderCard'
import CredentialsModal from '../components/CredentialsModal'
import MfaDialog from '../components/MfaDialog'

function Providers() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Credentials Modal state
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)


  // MFA Dialog state
  const [mfaDialogOpen, setMfaDialogOpen] = useState(false)
  const [mfaSession, setMfaSession] = useState(null) // { sessionId, provider, expiresAt }
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaError, setMfaError] = useState(null)
  const [pollingActive, setPollingActive] = useState(false)

  // Update ref when dialog state changes
  useEffect(() => {
    mfaDialogOpenRef.current = mfaDialogOpen
  }, [mfaDialogOpen])

  // Status polling
  const pollingIntervalRef = useRef(null)
  const mfaDialogOpenRef = useRef(false)

  useEffect(() => {
    fetchProviders()
    
    // Cleanup polling on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  const fetchProviders = async () => {
    try {
      setLoading(true)
      const data = await api.listProviders()
      setProviders(data.providers || [])
      setError(null)
    } catch (err) {
      setError('Failed to load providers')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = (provider) => {
    setSelectedProvider(provider)
    setCredentialsModalOpen(true)
  }

  const handleCredentialsSubmit = async (username, password) => {
    setTestingConnection(true)
    
    try {
      const response = await api.testProviderConnection(
        selectedProvider,
        username,
        password
      )

      if (response.status === 'success') {
        // Connection successful
        setCredentialsModalOpen(false)
        alert(`Successfully connected to ${selectedProvider}!`)
      } else if (response.status === 'mfa_required') {
        // MFA required - device verification is handled automatically
        console.log('MFA required, creating session:', response.session_id)
        setCredentialsModalOpen(false)
        setMfaSession({
          sessionId: response.session_id,
          provider: response.provider,
          expiresAt: response.expires_at
        })
        
        // Start polling for session status - MFA dialog will open when state changes to "awaiting_code"
        console.log('Starting polling for MFA session:', response.session_id)
        startStatusPolling(response.provider, response.session_id)
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Connection test failed'
      alert(`Connection failed: ${errorMessage}`)
    } finally {
      setTestingConnection(false)
    }
  }

  const handleCredentialsCancel = () => {
    setCredentialsModalOpen(false)
    setSelectedProvider(null)
  }


  const handleMfaSubmit = async (code) => {
    if (!mfaSession) return

    setMfaLoading(true)
    setMfaError(null)

    try {
      const response = await api.submitMfaCode(
        mfaSession.provider,
        mfaSession.sessionId,
        code
      )

      if (response.status === 'success') {
        // MFA verification successful
        setMfaDialogOpen(false)
        setMfaSession(null)
        stopStatusPolling()
        alert(`Successfully connected to ${mfaSession.provider}!`)
      }
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'MFA verification failed'
      setMfaError(errorMessage)
      
      // Check if we can retry
      const canRetry = err.response?.data?.can_retry
      if (!canRetry) {
        // Max retries reached or session invalid
        setTimeout(() => {
          setMfaDialogOpen(false)
          setMfaSession(null)
          stopStatusPolling()
        }, 2000)
      }
    } finally {
      setMfaLoading(false)
    }
  }

  const handleMfaCancel = async () => {
    if (mfaSession) {
      try {
        await api.cancelLoginSession(mfaSession.provider, mfaSession.sessionId)
      } catch (err) {
        console.error('Failed to cancel login session:', err)
      }
    }
    
    setMfaDialogOpen(false)
    setMfaSession(null)
    setMfaError(null)
    stopStatusPolling()
  }

  const startStatusPolling = (provider, sessionId) => {
    // Clear any existing polling
    stopStatusPolling()

    console.log('Starting status polling for session:', sessionId, 'provider:', provider)
    setPollingActive(true)

    // Poll every 2 seconds
    pollingIntervalRef.current = setInterval(async () => {
      try {
        console.log('Polling for session status...', provider, sessionId)
        console.log('Polling interval ID:', pollingIntervalRef.current)
        
        const status = await api.getLoginStatus(provider, sessionId)
        console.log('Session status response:', status)
        console.log('Current MFA dialog open state:', mfaDialogOpenRef.current)
        console.log('MFA session data:', mfaSession)
        
        // Validate response format
        if (!status || typeof status.status !== 'string') {
          console.error('Invalid status response format:', status)
          return
        }
        
        if (status.status === 'expired') {
          // Session expired
          console.log('Session expired, stopping polling')
          setMfaError('Session expired. Please try again.')
          setTimeout(() => {
            handleMfaCancel()
          }, 2000)
        } else if (status.status === 'completed') {
          // Login completed (should have been handled by submit response)
          console.log('Session completed, stopping polling')
          setMfaDialogOpen(false)
          setMfaSession(null)
          stopStatusPolling()
        } else if (status.status === 'failed') {
          // Login failed
          console.log('Session failed:', status.error_message)
          setMfaError(status.error_message || 'Login failed')
        } else if (status.status === 'awaiting_code') {
          // Device verification completed, now waiting for MFA code
          console.log('Session state is awaiting_code, opening MFA dialog. Current dialog state:', mfaDialogOpenRef.current)
          if (!mfaDialogOpenRef.current) {
            console.log('Opening MFA dialog...')
            setMfaDialogOpen(true)
            setMfaError(null)
          } else {
            console.log('MFA dialog already open, skipping')
          }
        } else if (status.status === 'awaiting_device_verification') {
          console.log('Session still awaiting device verification...')
        } else {
          console.log('Unknown session status:', status.status)
        }
        // Note: 'awaiting_device_verification' state is handled automatically by browser automation
      } catch (err) {
        console.error('Status polling error:', err)
        console.error('Error details:', {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
          sessionId: sessionId,
          provider: provider
        })
        
        // If it's a 404 error, the session might not exist
        if (err.response?.status === 404) {
          console.log('Session not found, stopping polling')
          setMfaError('Session not found or expired')
          stopStatusPolling()
        }
      }
    }, 2000)
  }

  const stopStatusPolling = () => {
    if (pollingIntervalRef.current) {
      console.log('Stopping status polling')
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      setPollingActive(false)
    }
  }

  const handleConfigure = (provider) => {
    alert(`Configuring ${provider}...`)
    // Future: Open configuration modal
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Providers</h1>
        <p className="text-gray-600 mt-2">
          Connect your grocery store accounts to automatically sync receipts.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-600">Loading providers...</div>
      ) : error ? (
        <div className="card bg-red-50 border border-red-200">
          <p className="text-red-600">{error}</p>
          <button
            onClick={fetchProviders}
            className="btn btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {providers.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              status="inactive"
              onTest={handleTestConnection}
              onConfigure={handleConfigure}
            />
          ))}
          {providers.length === 0 && (
            <div className="card col-span-2">
              <p className="text-center text-gray-600">
                No providers available yet.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Polling Status Indicator */}
      {pollingActive && (
        <div className="fixed bottom-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-3 shadow-lg">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-blue-800 text-sm font-medium">
              Waiting for device verification...
            </span>
          </div>
        </div>
      )}

      {/* Credentials Modal */}
      <CredentialsModal
        isOpen={credentialsModalOpen}
        onSubmit={handleCredentialsSubmit}
        onCancel={handleCredentialsCancel}
        provider={selectedProvider || ''}
        loading={testingConnection}
      />

      {/* MFA Dialog */}
      <MfaDialog
        isOpen={mfaDialogOpen}
        onSubmit={handleMfaSubmit}
        onCancel={handleMfaCancel}
        loading={mfaLoading}
        error={mfaError}
        provider={mfaSession?.provider || ''}
        expiresAt={mfaSession?.expiresAt}
      />
    </div>
  )
}

export default Providers

