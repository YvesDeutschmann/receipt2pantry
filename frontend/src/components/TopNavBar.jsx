import { useState, useEffect } from 'react'
import { Link, useLocation, NavLink } from 'react-router-dom'
import { Home, Users } from 'lucide-react'
import { api } from '../services/apiClient'
import HouseholdModal from './HouseholdModal'

function TopNavBar() {
  const location = useLocation()
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)

  const userId =
    localStorage.getItem('user_id') || '00000000-0000-0000-0000-000000000001'

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

  const navLinkClass = ({ isActive }) =>
    `pb-4 pt-5 font-medium transition-colors ${
      isActive ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-600 hover:text-gray-900'
    }`

  return (
    <>
      <header className="bg-white shadow-sm shrink-0">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link
                to="/"
                className="flex items-center gap-2 text-2xl font-bold text-primary-600"
              >
                <Home className="w-7 h-7" />
                GrocerySync
              </Link>
              <nav className="flex space-x-6">
                <NavLink to="/" className={navLinkClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/pantry" className={navLinkClass}>
                  Pantry
                </NavLink>
                <NavLink to="/recipes" className={navLinkClass}>
                  Recipe Ideas
                </NavLink>
                <NavLink to="/meal-plan" className={navLinkClass}>
                  Meal Plan
                </NavLink>
                <NavLink to="/providers" className={navLinkClass}>
                  Providers
                </NavLink>
                <NavLink to="/settings" className={navLinkClass}>
                  Settings
                </NavLink>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setHouseholdModalOpen(true)}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                title="Manage Household"
              >
                <Users className="w-5 h-5 text-gray-600" />
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
              <button className="btn btn-primary">Sign In</button>
            </div>
          </div>
        </div>
      </header>

      <HouseholdModal
        isOpen={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userId={userId}
        onHouseholdChange={handleHouseholdChange}
      />
    </>
  )
}

export default TopNavBar
