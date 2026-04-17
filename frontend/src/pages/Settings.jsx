import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Store, Users } from 'lucide-react'
import { api } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from '../components/HouseholdModal'
import PageHeader from '../components/PageHeader'

function Settings() {
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false)
  const [refreshSuggestionsMessage, setRefreshSuggestionsMessage] = useState(null)
  
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

  const handleRefreshSuggestions = async () => {
    if (!userId) return
    setRefreshingSuggestions(true)
    setRefreshSuggestionsMessage(null)
    try {
      await api.suggestions.triggerGeneration(userId, {
        triggerReason: 'manual_refresh',
        householdId: household?.id ?? null,
      })
      setRefreshSuggestionsMessage('Suggestions updated.')
      setTimeout(() => setRefreshSuggestionsMessage(null), 4000)
    } catch (err) {
      console.error('Refresh suggestions failed:', err)
      setRefreshSuggestionsMessage(
        err.response?.data?.error || 'Could not refresh suggestions. Try again later.'
      )
    } finally {
      setRefreshingSuggestions(false)
    }
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
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Household</h2>
          <p className="text-sm text-sage-light mb-4">
            Share your pantry, receipts, and cooking history with family members.
          </p>
          
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-terra"></div>
            </div>
          ) : household ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-forest-light rounded-mise-md">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-forest rounded-mise-md">
                    <Users className="w-6 h-6 text-terra" />
                  </div>
                  <div>
                    <p className="font-medium text-cream">{household.name}</p>
                    <p className="text-sm text-sage-light">
                      You are {household.role === 'owner' ? 'the owner' : 'a member'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setHouseholdModalOpen(true)}
                  className="btn btn-ghost"
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
              <div className="mx-auto w-12 h-12 bg-forest-light rounded-full flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-sage-light" />
              </div>
              <p className="text-sage-light mb-4">
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
        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-2">Recipe suggestions</h2>
          <p className="text-sm text-sage-light mb-4">
            Regenerate your background suggestion pool from your current pantry (may take a minute).
          </p>
          {refreshSuggestionsMessage && (
            <p className="text-sm text-cream mb-3" role="status">
              {refreshSuggestionsMessage}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={refreshingSuggestions || !userId}
            onClick={() => void handleRefreshSuggestions()}
          >
            {refreshingSuggestions ? 'Refreshing…' : 'Refresh suggestions'}
          </button>
        </div>

        <Link to="/providers" className="block">
          <div className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-forest rounded-mise-md">
                  <Store className="w-6 h-6 text-terra" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-semibold text-cream">Connected Stores</h2>
                  <p className="text-sm text-sage-light">
                    Connect Safeway, Costco, and other grocery accounts to sync receipts
                  </p>
                </div>
              </div>
              <span className="text-terra font-medium">Manage →</span>
            </div>
          </div>
        </Link>

        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Account Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-light mb-2">
                Email
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                className="input"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-light mb-2">
                Name
              </label>
              <input
                type="text"
                placeholder="Your Name"
                className="input"
                disabled
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Preferences</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cream">Email Notifications</p>
                <p className="text-sm text-sage-light">
                  Receive notifications about new receipts
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-forest-light peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-terra/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-cream after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-cream after:border-forest-light after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terra"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cream">Auto-sync Receipts</p>
                <p className="text-sm text-sage-light">
                  Automatically fetch new receipts daily
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-forest-light peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-terra/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-cream after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-cream after:border-forest-light after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terra"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-display font-semibold mb-4 text-[var(--color-error)]">Danger Zone</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-[var(--color-error)] rounded-mise-md">
              <div>
                <p className="font-medium text-cream">Delete Account</p>
                <p className="text-sm text-sage-light">
                  Permanently delete your account and all data
                </p>
              </div>
              <button className="btn bg-[var(--color-error)] text-cream hover:opacity-90">
                Delete
              </button>
            </div>
          </div>
        </div>

        {import.meta.env.DEV && (
          <div className="card border-dashed border-[var(--color-error)]/50">
            <h2 className="text-sm font-medium text-[var(--color-error)] mb-2">Dev Tools</h2>
            <button
              type="button"
              onClick={async () => {
                await api.devResetOnboarding()
                await supabase.auth.updateUser({
                  data: {
                    onboarding_completed_at: null,
                    cold_start_step: null,
                    cold_start_grocery_connected: null,
                    cold_start_pantry_template_completed_at: null,
                    whats_for_dinner_unlocked: null,
                    bridge_chose_providers: null,
                    bridge_chose_manual: null,
                    cold_start_skip_grocery: null,
                  },
                })
                window.location.reload()
              }}
              className="text-sm text-[var(--color-error)] underline"
            >
              Reset onboarding state
            </button>
          </div>
        )}
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
