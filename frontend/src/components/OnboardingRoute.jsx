import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { OnboardingProvider } from '../contexts/OnboardingContext'

function OnboardingRoute() {
  const { user, loading, onboardingComplete } = useAuth()

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

  if (onboardingComplete) {
    return <Navigate to="/" replace />
  }

  return (
    <OnboardingProvider>
      <Outlet />
    </OnboardingProvider>
  )
}

export default OnboardingRoute
