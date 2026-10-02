import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/PageHeader'
import CostcoOneTapSync from '../components/CostcoOneTapSync'
import SafewayConnectCard from '../components/SafewayConnectCard'

const MVP_PROVIDERS = ['safeway', 'costco']

function Providers() {
  const { user, onboardingComplete } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id

  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
      setError(null)
    } catch (err) {
      setError('Failed to load stores')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Stores"
        subtitle="Connect your grocery store accounts to automatically sync receipts."
      />

      {!onboardingComplete && user?.user_metadata?.cold_start_step === 1 && (
        <div className="mb-6 p-4 rounded-meald-md border border-sage/30 bg-forest-light">
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
        <div className="text-center py-8 text-sage-light">Loading stores…</div>
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
            if (provider === 'costco') {
              return <CostcoOneTapSync key={provider} userId={userId} days={90} />
            }
            if (provider === 'safeway') {
              return <SafewayConnectCard key={provider} userId={userId} />
            }
            return null
          })}
          {providers.length === 0 && (
            <div className="card col-span-2">
              <p className="text-center text-sage-light">
                No stores available yet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Providers
