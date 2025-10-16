import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import ProviderCard from '../components/ProviderCard'

function Providers() {
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
      setProviders(data.providers || [])
      setError(null)
    } catch (err) {
      setError('Failed to load providers')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async (provider) => {
    alert(`Testing connection for ${provider}...`)
    // In production, would open a modal for credentials
  }

  const handleConfigure = async (provider) => {
    alert(`Configuring ${provider}...`)
    // In production, would open a configuration modal
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
    </div>
  )
}

export default Providers

