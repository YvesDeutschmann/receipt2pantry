import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import Dashboard from './pages/Dashboard'
import Pantry from './pages/Pantry'
import Providers from './pages/Providers'
import Settings from './pages/Settings'
import Recipes from './pages/Recipes'
import MealPlan from './pages/MealPlan'

function App() {
  return (
    <Router>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="pantry" element={<Pantry />} />
          <Route path="recipes" element={<Recipes />} />
          <Route path="meal-plan" element={<MealPlan />} />
          <Route path="settings" element={<Settings />} />
          <Route path="providers" element={<Providers />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
