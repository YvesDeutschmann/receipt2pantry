import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Store, Users } from 'lucide-react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from '../components/HouseholdModal'
import PageHeader from '../components/PageHeader'

function Settings() {
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  
  const { user } = useAuth()
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

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account preferences and application settings."
      />

      <div className="space-y-6">
        {/* Household Settings */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Household</h2>
          <p className="text-sm text-gray-600 mb-4">
            Share your pantry, receipts, and cooking history with family members.
          </p>
          
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            </div>
          ) : household ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <Users className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{household.name}</p>
                    <p className="text-sm text-gray-500">
                      You are {household.role === 'owner' ? 'the owner' : 'a member'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setHouseholdModalOpen(true)}
                  className="btn btn-secondary"
                >
                  Manage
                </button>
              </div>
              
              {household.role === 'owner' && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700 mb-2">
                    Invite others with your join code:
                  </p>
                  <code className="px-3 py-1 bg-white border border-blue-200 rounded font-mono text-lg tracking-widest">
                    {household.join_code}
                  </code>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-600 mb-4">
                No household yet. Create or join one to share with family.
              </p>
              <button
                onClick={() => setHouseholdModalOpen(true)}
                className="btn btn-primary"
              >
                Set Up Household
              </button>
            </div>
          )}
        </div>

        {/* Connected Stores - links to Providers */}
        <Link to="/providers" className="block">
          <div className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <Store className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Connected Stores</h2>
                  <p className="text-sm text-gray-600">
                    Connect Safeway, Costco, and other grocery accounts to sync receipts
                  </p>
                </div>
              </div>
              <span className="text-primary-600 font-medium">Manage →</span>
            </div>
          </div>
        </Link>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Account Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Name
              </label>
              <input
                type="text"
                placeholder="Your Name"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Preferences</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-gray-600">
                  Receive notifications about new receipts
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-sync Receipts</p>
                <p className="text-sm text-gray-600">
                  Automatically fetch new receipts daily
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4 text-red-600">Danger Zone</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg">
              <div>
                <p className="font-medium">Delete Account</p>
                <p className="text-sm text-gray-600">
                  Permanently delete your account and all data
                </p>
              </div>
              <button className="btn bg-red-600 text-white hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Household Modal */}
      <HouseholdModal
        isOpen={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userId={userId}
        onHouseholdChange={handleHouseholdChange}
      />
    </div>
  )
}

export default Settings
