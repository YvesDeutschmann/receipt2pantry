import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Pantry from './pages/Pantry'
import Providers from './pages/Providers'
import Settings from './pages/Settings'
import Recipes from './pages/Recipes'
import MealPlan from './pages/MealPlan'
import Auth from './pages/Auth'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/auth" element={<Auth />} />
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
            <Route path="meal-plan" element={<MealPlan />} />
            <Route path="settings" element={<Settings />} />
            <Route path="providers" element={<Providers />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
