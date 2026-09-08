import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ColdStartProvider } from './contexts/ColdStartContext'
import { useAppSyncScheduler } from './hooks/useAppSyncScheduler'
import { useProviderAttentionSync } from './hooks/useProviderAttentionSync'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Pantry from './pages/Pantry'
import Providers from './pages/Providers'
import Settings from './pages/Settings'
import Recipes from './pages/Recipes'
import MealPlan from './pages/MealPlan'
import { FEATURES } from './config/features'
import Auth from './pages/Auth'
import ProtectedRoute from './components/ProtectedRoute'
import OnboardingRoute from './components/OnboardingRoute'
import HouseholdFork from './pages/onboarding/HouseholdFork'
import JoinHousehold from './pages/onboarding/JoinHousehold'
import HouseholdSize from './pages/onboarding/HouseholdSize'
import DietaryRestrictions from './pages/onboarding/DietaryRestrictions'
import BridgeScreen from './pages/onboarding/BridgeScreen'
import StaplesTemplate from './pages/onboarding/StaplesTemplate'
import CostcoDiagnosticOverlay from './components/CostcoDiagnosticOverlay'

function AppRoutes() {
  const { user } = useAuth()
  useAppSyncScheduler({ userId: user?.id ?? null })
  useProviderAttentionSync()

  return (
    <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<OnboardingRoute />}>
              <Route index element={<HouseholdFork />} />
              <Route path="join" element={<JoinHousehold />} />
              <Route path="size" element={<HouseholdSize />} />
              <Route path="dietary" element={<DietaryRestrictions />} />
              <Route path="bridge" element={<BridgeScreen />} />
              <Route path="pantry-setup" element={<StaplesTemplate />} />
            </Route>
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="pantry" element={<Pantry />} />
              <Route path="recipes" element={<Recipes />} />
              {FEATURES.mealPlanner && (
                <Route path="meal-plan" element={<MealPlan />} />
              )}
              <Route path="settings" element={<Settings />} />
              <Route path="providers" element={<Providers />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <ColdStartProvider>
        <Router>
          <AppRoutes />
          <CostcoDiagnosticOverlay />
        </Router>
      </ColdStartProvider>
    </AuthProvider>
  )
}

export default App
