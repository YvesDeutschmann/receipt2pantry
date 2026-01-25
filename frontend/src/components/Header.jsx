import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../services/apiClient'
import HouseholdModal from './HouseholdModal'

function Header() {
  const location = useLocation()
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // For demo purposes - in production this would come from auth
  const userId = localStorage.getItem('user_id') || 'demo-user'
  
  useEffect(() => {
    fetchHousehold()
  }, [userId])

  const fetchHousehold = async () => {
    try {
      const response = await api.getHousehold(userId)
      setHousehold(response.household)
    } catch (err) {
      console.error('Failed to fetch household:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleHouseholdChange = (newHousehold) => {
    setHousehold(newHousehold)
  }
  
  const isActive = (path) => {
    return location.pathname === path
      ? 'text-primary-600 border-b-2 border-primary-600'
      : 'text-gray-600 hover:text-gray-900'
  }

  return (
    <>
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link to="/" className="text-2xl font-bold text-primary-600">
                GrocerySync
              </Link>
              <nav className="flex space-x-6">
                <Link
                  to="/"
                  className={`pb-4 pt-5 font-medium transition-colors ${isActive('/')}`}
                >
                  Dashboard
                </Link>
                <Link
                  to="/providers"
                  className={`pb-4 pt-5 font-medium transition-colors ${isActive('/providers')}`}
                >
                  Providers
                </Link>
                <Link
                  to="/settings"
                  className={`pb-4 pt-5 font-medium transition-colors ${isActive('/settings')}`}
                >
                  Settings
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              {/* Household Button */}
              <button
                onClick={() => setHouseholdModalOpen(true)}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="Manage Household"
              >
                <svg 
                  className="w-5 h-5 text-gray-600" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" 
                  />
                </svg>
                {!loading && (
                  <span className="text-sm text-gray-700">
                    {household ? household.name : 'No Household'}
                  </span>
                )}
                {household && (
                  <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                    {household.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                )}
              </button>
              
              <button className="btn btn-primary">
                Sign In
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Household Modal */}
      <HouseholdModal
        isOpen={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userId={userId}
        onHouseholdChange={handleHouseholdChange}
      />
    </>
  )
}

export default Header
