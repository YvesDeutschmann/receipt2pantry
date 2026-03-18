import { useState, useEffect } from 'react'
import { Link, useLocation, NavLink } from 'react-router-dom'
import { Home, Users, LogOut } from 'lucide-react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from './HouseholdModal'

function TopNavBar() {
  const location = useLocation()
  const { user, signOut } = useAuth()
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const userId = user?.id

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
      isActive ? 'text-cream border-b-2 border-terra' : 'text-sage-light hover:text-cream'
    }`

  return (
    <>
      <header className="bg-forest-mid shadow-mise-sm shrink-0">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link
                to="/"
                className="flex items-center gap-2 text-2xl font-display font-bold text-cream"
              >
                <Home className="w-7 h-7 text-terra" />
                Meald
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
                className="flex items-center space-x-2 px-3 py-2 rounded-mise-md hover:bg-forest-light transition-colors"
                title="Manage Household"
              >
                <Users className="w-5 h-5 text-sage-light" />
                {!loading && (
                  <span className="text-sm text-cream">
                    {household ? household.name : 'No Household'}
                  </span>
                )}
                {household && (
                  <span className="px-1.5 py-0.5 bg-forest-light text-sage text-xs rounded-full">
                    {household.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-sage-light max-w-[140px] truncate" title={user?.email}>
                  {user?.email}
                </span>
                <button
                  onClick={() => signOut()}
                  className="btn btn-ghost flex items-center gap-1"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
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
