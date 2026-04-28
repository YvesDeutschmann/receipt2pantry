import { useState } from 'react'

function ProviderCard({ provider, status, onTest, onConfigure }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const statusColors = {
    active: 'bg-forest-light text-sage',
    inactive: 'bg-forest-light text-sage-light',
    error: 'bg-[var(--color-error)]/10 text-[var(--color-error)]',
  }

  const statusText = {
    active: 'Active',
    inactive: 'Not Configured',
    error: 'Error',
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-forest-light rounded-mise-md flex items-center justify-center">
            <span className="text-2xl font-bold text-terra">
              {provider.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-display font-semibold text-cream capitalize">{provider}</h3>
            <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${statusColors[status] || statusColors.inactive}`}>
              {statusText[status] || statusText.inactive}
            </span>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="btn btn-ghost"
          >
            {isExpanded ? 'Hide' : 'Details'}
          </button>
          <button
            onClick={() => onConfigure(provider)}
            className="btn btn-primary"
          >
            Configure
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-sage-light">Provider:</span>
              <span className="font-medium capitalize">{provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sage-light">Status:</span>
              <span className="font-medium">{statusText[status]}</span>
            </div>
            {status === 'active' && (
              <div className="flex justify-between">
                <span className="text-sage-light">Last Login:</span>
                <span className="font-medium">Recently</span>
              </div>
            )}
          </div>
          <button
            onClick={() => onTest(provider)}
            className="btn btn-secondary w-full mt-4"
          >
            Test Connection
          </button>
        </div>
      )}
    </div>
  )
}

export default ProviderCard

