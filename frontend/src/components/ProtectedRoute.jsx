import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function ProtectedRoute({ children }) {
  const { user, loading, onboardingComplete } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-forest">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-terra border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (!onboardingComplete) {
    const path = location.pathname
    const allowDuringOnboarding =
      path === '/providers' || path.startsWith('/providers/')
    if (!allowDuringOnboarding) {
      return <Navigate to="/onboarding" replace />
    }
  }

  return children
}

export default ProtectedRoute
