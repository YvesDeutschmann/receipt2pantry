import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/PageHeader'
import CostcoConnectPage from '../components/CostcoConnectPage'
import CostcoOneTapSync from '../components/CostcoOneTapSync'
import SafewayConnectCard from '../components/SafewayConnectCard'

const MVP_PROVIDERS = ['safeway', 'costco']

function Providers() {
  const { user, onboardingComplete } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id

  const [providers, setProviders] = useState([])
  const [providerStatuses, setProviderStatuses] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [fetchingReceipts, setFetchingReceipts] = useState(false)
  const [showCostcoConnect, setShowCostcoConnect] = useState(false)

  useEffect(() => {
    fetchProviders()
  }, [])

  const fetchProviders = async () => {
    try {
      setLoading(true)
      const data = await api.listProviders()
      const providerList = (data.providers || []).filter((p) =>
        MVP_PROVIDERS.includes(p)
      )
      setProviders(providerList)

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

    try {
      const response = await api.fetchReceiptsWithStoredCredentials(provider, userId, 14)
      alert(`✅ Fetched ${response.count} receipts from ${provider}! Added ${response.items_added_to_pantry} items to pantry.`)
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Failed to fetch receipts'

      if (err.response?.data?.expired_credentials) {
        alert(`⚠️  Your ${provider} credentials have expired. Please reconnect your account.`)
      } else {
        alert(`❌ Failed to fetch receipts: ${errorMessage}`)
      }
    } finally {
      setFetchingReceipts(false)
    }
  }

  const handleConnectCostco = () => {
    setShowCostcoConnect(true)
  }

  const handleCostcoConnectSuccess = async () => {
    setShowCostcoConnect(false)
    await new Promise(resolve => setTimeout(resolve, 300))
    await fetchProviders()
    alert('Costco account connected successfully!')
  }

  const handleCostcoConnectCancel = () => {
    setShowCostcoConnect(false)
  }

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

      {!onboardingComplete && user?.user_metadata?.cold_start_step === 1 && (
        <div className="mb-6 p-4 rounded-mise-md border border-sage/30 bg-forest-light">
          <p className="text-sm text-cream mb-3">
            When you&apos;re done connecting or syncing, continue to your pantry staples checklist.
          </p>
          <button
            type="button"
            onClick={() => navigate('/onboarding/pantry-setup', { replace: true })}
            className="btn btn-secondary text-sm"
          >
            Continue pantry setup
          </button>
        </div>
      )}

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
                        <CostcoOneTapSync userId={userId} days={90} />
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
                  ) : provider === 'safeway' ? (
                    <div className="w-full space-y-3">
                      <div className="p-3 bg-forest-light rounded-mise-md border border-forest-light">
                        <p className="text-xs font-medium text-sage-light mb-2">Connect Safeway</p>
                        <SafewayConnectCard userId={userId} />
                      </div>
                    </div>
                  ) : null}
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
      )}
    </div>
  )
}

export default Providers
