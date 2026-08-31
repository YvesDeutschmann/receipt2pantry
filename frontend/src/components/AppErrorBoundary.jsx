import React from 'react'
import { Sentry, captureHandledError } from '../services/monitoring'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { eventId: null, hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    const eventId = captureHandledError(error, {
      componentStack: errorInfo?.componentStack?.slice?.(0, 500) ?? '',
    })
    this.setState({ eventId: eventId || null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F0E8] p-6">
        <div className="max-w-md w-full rounded-2xl bg-white shadow p-6 text-center space-y-4">
          <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
          <p className="text-sm text-gray-600">
            We hit an unexpected error. Try reloading the app. If it keeps happening, contact support
            {this.state.eventId ? ` with reference ${this.state.eventId}` : ''}.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}

// Re-export for tests that need Sentry scope helpers
export { Sentry }
