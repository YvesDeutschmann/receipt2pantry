import { useState, useEffect, useRef } from 'react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import ProviderCard from '../components/ProviderCard'
import PageHeader from '../components/PageHeader'
import CredentialsModal from '../components/CredentialsModal'
import MfaDialog from '../components/MfaDialog'
import CostcoConnectPage from '../components/CostcoConnectPage'
import CostcoOneTapSync from '../components/CostcoOneTapSync'

function Providers() {
  const { user } = useAuth()
  const userId = user?.id
  const [providers, setProviders] = useState([])
  const [providerStatuses, setProviderStatuses] = useState({}) // { providerName: { configured, active } }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Credentials Modal state
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)
  
  // Fetch Receipts state
  const [fetchMode, setFetchMode] = useState(false) // true = fetch receipts, false = test connection
  const [fetchingReceipts, setFetchingReceipts] = useState(false)
  const [fetchedReceipts, setFetchedReceipts] = useState(null)
  const [receiptError, setReceiptError] = useState(null)


  // MFA Dialog state
  const [mfaDialogOpen, setMfaDialogOpen] = useState(false)
  const [mfaSession, setMfaSession] = useState(null) // { sessionId, provider, expiresAt }
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaError, setMfaError] = useState(null)
  const [pollingActive, setPollingActive] = useState(false)

  // Costco Connect Page state
  const [showCostcoConnect, setShowCostcoConnect] = useState(false)

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
      const providerList = data.providers || []
      setProviders(providerList)
      
      // Fetch status for each provider
      const statuses = {}
      await Promise.all(
        providerList.map(async (provider) => {
          try {
            const status = await api.getProviderStatus(provider, userId)
            statuses[provider] = status
          } catch (err) {
            console.error(`Failed to get status for ${provider}:`, err)
            statuses[provider] = { configured: false, active: false }
          }
        })
      )
      setProviderStatuses(statuses)
      setError(null)
    } catch (err) {
      setError('Failed to load providers')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleFetchWithStoredCredentials = async (provider) => {
    setFetchingReceipts(true)
    setFetchedReceipts(null)
    setReceiptError(null)
    
    try {
      const response = await api.fetchReceiptsWithStoredCredentials(provider, userId, 14)
      setFetchedReceipts(response.receipts)
      alert(`✅ Fetched ${response.count} receipts from ${provider}! Added ${response.items_added_to_pantry} items to pantry.`)
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Failed to fetch receipts'
      setReceiptError(errorMessage)
      
      // If credentials expired, show reconnect option
      if (err.response?.data?.expired_credentials) {
        alert(`⚠️  Your ${provider} credentials have expired. Please reconnect your account.`)
      } else {
        alert(`❌ Failed to fetch receipts: ${errorMessage}`)
      }
    } finally {
      setFetchingReceipts(false)
    }
  }

  const handleTestConnection = (provider) => {
    setSelectedProvider(provider)
    setFetchMode(false)
    setCredentialsModalOpen(true)
  }

  const handleFetchReceipts = (provider) => {
    setSelectedProvider(provider)
    setFetchMode(true)
    setFetchedReceipts(null)
    setReceiptError(null)
    setCredentialsModalOpen(true)
  }

  const handleCredentialsSubmit = async (username, password) => {
    if (fetchMode) {
      // Fetch receipts mode
      setFetchingReceipts(true)
      setReceiptError(null)
      
      try {
        const response = await api.fetchReceipts(
          selectedProvider,
          username,
          password,
          14, // Last 14 days
          userId
        )

        if (response.status === 'success') {
          setCredentialsModalOpen(false)
          setFetchedReceipts(response.receipts)
          alert(`Fetched ${response.count} receipts from ${selectedProvider}!`)
        } else if (response.status === 'mfa_required') {
          setCredentialsModalOpen(false)
          setMfaSession({
            sessionId: response.session_id,
            provider: response.provider,
            expiresAt: response.expires_at,
            fetchAfterMfa: true
          })
          startStatusPolling(response.provider, response.session_id)
        }
      } catch (err) {
        const errorMessage = err.response?.data?.error || 'Failed to fetch receipts'
        setReceiptError(errorMessage)
        alert(`Failed to fetch receipts: ${errorMessage}`)
      } finally {
        setFetchingReceipts(false)
      }
    } else {
      // Test connection mode (original behavior)
      setTestingConnection(true)
      
      try {
        const response = await api.testProviderConnection(
          selectedProvider,
          username,
          password
        )

        if (response.status === 'success') {
          setCredentialsModalOpen(false)
          alert(`Successfully connected to ${selectedProvider}!`)
        } else if (response.status === 'mfa_required') {
          setCredentialsModalOpen(false)
          setMfaSession({
            sessionId: response.session_id,
            provider: response.provider,
            expiresAt: response.expires_at,
            fetchAfterMfa: false
          })
          startStatusPolling(response.provider, response.session_id)
        }
      } catch (err) {
        const errorMessage = err.response?.data?.error || 'Connection test failed'
        alert(`Connection failed: ${errorMessage}`)
      } finally {
        setTestingConnection(false)
      }
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
        stopStatusPolling()
        
        // Check if we should fetch receipts after MFA
        if (mfaSession.fetchAfterMfa) {
          setMfaDialogOpen(false)
          alert('MFA successful! Fetching receipts...')
          
          try {
            const receiptsResponse = await api.fetchReceiptsAfterMfa(
              mfaSession.provider,
              mfaSession.sessionId,
              14
            )
            setFetchedReceipts(receiptsResponse.receipts)
            alert(`Fetched ${receiptsResponse.count} receipts!`)
          } catch (fetchErr) {
            const fetchError = fetchErr.response?.data?.error || 'Failed to fetch receipts'
            setReceiptError(fetchError)
            alert(`MFA succeeded but receipt fetch failed: ${fetchError}`)
          }
          setMfaSession(null)
        } else {
          setMfaDialogOpen(false)
          setMfaSession(null)
          alert(`Successfully connected to ${mfaSession.provider}!`)
        }
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

    setPollingActive(true)

    // Poll every 2 seconds
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const status = await api.getLoginStatus(provider, sessionId)
        
        // Validate response format
        if (!status || typeof status.status !== 'string') {
          console.error('Invalid status response format:', status)
          return
        }
        
        if (status.status === 'expired') {
          // Session expired
          setMfaError('Session expired. Please try again.')
          setTimeout(() => {
            handleMfaCancel()
          }, 2000)
        } else if (status.status === 'completed') {
          // Login completed (should have been handled by submit response)
          setMfaDialogOpen(false)
          setMfaSession(null)
          stopStatusPolling()
        } else if (status.status === 'failed') {
          // Login failed
          setMfaError(status.error_message || 'Login failed')
        } else if (status.status === 'awaiting_code') {
          // Device verification completed, now waiting for MFA code
          if (!mfaDialogOpenRef.current) {
            setMfaDialogOpen(true)
            setMfaError(null)
          }
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
          setMfaError('Session not found or expired')
          stopStatusPolling()
        }
      }
    }, 2000)
  }

  const stopStatusPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      setPollingActive(false)
    }
  }

  const handleConfigure = (provider) => {
    alert(`Configuring ${provider}...`)
    // Future: Open configuration modal
  }

  const handleConnectCostco = () => {
    setShowCostcoConnect(true)
  }

  const handleCostcoConnectSuccess = async () => {
    setShowCostcoConnect(false)
    // Small delay to ensure backend transaction is committed
    await new Promise(resolve => setTimeout(resolve, 300))
    // Force immediate status refresh
    await fetchProviders()
    console.log('Provider statuses after refresh:', providerStatuses)
    alert('Costco account connected successfully!')
  }

  const handleCostcoConnectCancel = () => {
    setShowCostcoConnect(false)
  }

  // Show Costco Connect page if requested
  if (showCostcoConnect) {
    return (
      <CostcoConnectPage
        userId={userId}
        onSuccess={handleCostcoConnectSuccess}
        onCancel={handleCostcoConnectCancel}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Providers"
        subtitle="Connect your grocery store accounts to automatically sync receipts."
      />

      {loading ? (
        <div className="text-center py-8 text-sage-light">Loading providers...</div>
      ) : error ? (
        <div className="card border border-[var(--color-error)] bg-[var(--color-error)]/10">
          <p className="text-[var(--color-error)]">{error}</p>
          <button
            onClick={fetchProviders}
            className="btn btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {providers.map((provider) => {
              const status = providerStatuses[provider] || {}
              const isConnected = status.configured && status.active
              
              return (
                <div key={provider} className="card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-display font-semibold text-cream capitalize">{provider}</h3>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      isConnected 
                        ? 'bg-forest-light text-sage' 
                        : 'bg-forest-light text-sage-light'
                    }`}>
                      {isConnected ? '✓ Connected' : 'Not Connected'}
                    </span>
                  </div>
                  <p className="text-sage-light text-sm mb-4">
                    {isConnected 
                      ? `Your ${provider} account is connected and ready to fetch receipts.`
                      : `Connect your ${provider} account to automatically fetch receipts.`
                    }
                  </p>
                  <div className="flex gap-2">
                    {provider === 'costco' ? (
                      <div className="w-full space-y-3">
                        <div className="p-3 bg-forest-light rounded-mise-md border border-forest-light">
                          <p className="text-xs font-medium text-sage-light mb-2">One-Tap Sync</p>
                          <CostcoOneTapSync
                            userId={userId}
                            days={90}
                          />
                        </div>
                        <div className="flex gap-2">
                          {isConnected ? (
                            <>
                              <button
                                onClick={() => handleFetchWithStoredCredentials(provider)}
                                className="btn btn-primary flex-1"
                                disabled={fetchingReceipts}
                              >
                                {fetchingReceipts ? 'Fetching...' : 'Fetch Receipts'}
                              </button>
                              <button
                                onClick={handleConnectCostco}
                                className="btn btn-ghost"
                              >
                                Reconnect
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={handleConnectCostco}
                              className="btn btn-primary flex-1"
                            >
                              Connect Costco Account
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleTestConnection(provider)}
                          className="btn btn-secondary flex-1"
                        >
                          Test Connection
                        </button>
                        <button
                          onClick={() => handleFetchReceipts(provider)}
                          className="btn btn-primary flex-1"
                        >
                          Fetch Receipts
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {providers.length === 0 && (
              <div className="card col-span-2">
                <p className="text-center text-sage-light">
                  No providers available yet.
                </p>
              </div>
            )}
          </div>

          {/* Fetched Receipts Display */}
          {fetchedReceipts && fetchedReceipts.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-bold mb-4">Fetched Receipts ({fetchedReceipts.length})</h2>
              <div className="space-y-4">
                {fetchedReceipts.map((receipt, idx) => (
                  <div key={idx} className="card">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-cream">{receipt.order_id || `Order ${idx + 1}`}</p>
                        <p className="text-sm text-sage-light">{receipt.order_date}</p>
                      </div>
                      <p className="font-bold text-sage">${receipt.total_amount != null ? Number(receipt.total_amount).toFixed(2) : 'N/A'}</p>
                    </div>
                    {receipt.items && (
                      <div className="mt-2 text-sm text-sage-light">
                        {receipt.items.length} items
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
        loading={testingConnection || fetchingReceipts}
        title={fetchMode ? 'Fetch Receipts' : 'Test Connection'}
        submitText={fetchMode ? 'Fetch Receipts' : 'Test Connection'}
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

