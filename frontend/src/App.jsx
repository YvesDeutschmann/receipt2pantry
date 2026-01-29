import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import Dashboard from './pages/Dashboard'
import Pantry from './pages/Pantry'
import Providers from './pages/Providers'
import Settings from './pages/Settings'

function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        <footer className="bg-white border-t py-6 mt-auto">
          <div className="container mx-auto px-4 text-center text-gray-600 text-sm">
            © 2025 GrocerySync. All rights reserved.
          </div>
        </footer>
      </div>
    </Router>
  )
}

export default App

