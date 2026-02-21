import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import AdaptiveModal from './AdaptiveModal'

function HouseholdModal({ isOpen, onClose, userId, onHouseholdChange }) {
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('view') // 'view', 'create', 'join'
  
  // Form states
  const [householdName, setHouseholdName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (isOpen && userId) {
      fetchHousehold()
    }
  }, [isOpen, userId])

  const fetchHousehold = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getHousehold(userId)
      setHousehold(response.household)
      
      if (response.household) {
        const membersResponse = await api.getHouseholdMembers(userId)
        setMembers(membersResponse.members || [])
        setActiveTab('view')
      } else {
        setActiveTab('create')
      }
    } catch (err) {
      setError('Failed to load household information')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateHousehold = async (e) => {
    e.preventDefault()
    if (!householdName.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await api.createHousehold(userId, householdName.trim())
      setHousehold(response.household)
      setMembers([{ user_id: userId, role: 'owner' }])
      setHouseholdName('')
      setActiveTab('view')
      onHouseholdChange?.(response.household)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinHousehold = async (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await api.joinHousehold(userId, joinCode.trim().toUpperCase())
      setHousehold(response.household)
      setJoinCode('')
      await fetchHousehold()
      onHouseholdChange?.(response.household)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLeaveHousehold = async () => {
    if (!confirm('Are you sure you want to leave this household?')) return

    setSubmitting(true)
    setError(null)
    try {
      await api.leaveHousehold(userId)
      setHousehold(null)
      setMembers([])
      setActiveTab('create')
      onHouseholdChange?.(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to leave household')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegenerateCode = async () => {
    if (!confirm('Regenerate join code? The old code will no longer work.')) return

    setSubmitting(true)
    try {
      const response = await api.regenerateJoinCode(userId)
      setHousehold({ ...household, join_code: response.join_code })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to regenerate code')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(household?.join_code || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRemoveMember = async (memberUserId) => {
    if (!confirm('Remove this member from the household?')) return

    try {
      await api.removeMember(userId, memberUserId)
      setMembers(members.filter(m => m.user_id !== memberUserId))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member')
    }
  }

  return (
    <AdaptiveModal isOpen={isOpen} onClose={onClose} title="Household">
      <div className="p-4 sm:p-6">
      {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* Tabs when no household */}
              {!household && (
                <div className="flex border-b border-gray-200 mb-4">
                  <button
                    onClick={() => setActiveTab('create')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'create'
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => setActiveTab('join')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'join'
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Join Existing
                  </button>
                </div>
              )}

              {/* View Household */}
              {household && activeTab === 'view' && (
                <div className="space-y-4">
                  {/* Household Info */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">{household.name}</h3>
                        <p className="text-sm text-gray-500">
                          {household.role === 'owner' ? 'Owner' : 'Member'}
                        </p>
                      </div>
                      {household.role === 'owner' && (
                        <span className="px-2 py-1 bg-primary-100 text-primary-700 text-xs rounded-full">
                          Owner
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Join Code (owner only) */}
                  {household.role === 'owner' && (
                    <div className="bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-blue-700 mb-2">Share this code to invite members:</p>
                      <div className="flex items-center space-x-2">
                        <code className="flex-1 bg-white px-3 py-2 rounded border border-blue-200 font-mono text-lg text-center tracking-widest">
                          {household.join_code}
                        </code>
                        <button
                          onClick={handleCopyCode}
                          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <button
                        onClick={handleRegenerateCode}
                        disabled={submitting}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        Regenerate code
                      </button>
                    </div>
                  )}

                  {/* Members List */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">
                      Members ({members.length})
                    </h4>
                    <div className="space-y-2">
                      {members.map((member) => (
                        <div
                          key={member.user_id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {member.user_id === userId ? 'You' : `Member`}
                              </p>
                              <p className="text-xs text-gray-500">{member.role}</p>
                            </div>
                          </div>
                          {household.role === 'owner' && member.user_id !== userId && (
                            <button
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Leave Household */}
                  <button
                    onClick={handleLeaveHousehold}
                    disabled={submitting}
                    className="w-full mt-4 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    {household.role === 'owner' && members.length === 1 
                      ? 'Delete Household' 
                      : 'Leave Household'}
                  </button>
                </div>
              )}

              {/* Create Household Form */}
              {!household && activeTab === 'create' && (
                <form onSubmit={handleCreateHousehold} className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Create a household to share your pantry and receipts with family members.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Household Name
                    </label>
                    <input
                      type="text"
                      value={householdName}
                      onChange={(e) => setHouseholdName(e.target.value)}
                      placeholder="e.g., Smith Family"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      maxLength={100}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !householdName.trim()}
                    className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? 'Creating...' : 'Create Household'}
                  </button>
                </form>
              )}

              {/* Join Household Form */}
              {!household && activeTab === 'join' && (
                <form onSubmit={handleJoinHousehold} className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Enter the 6-character code shared by the household owner.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Join Code
                    </label>
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-center text-lg tracking-widest uppercase"
                      maxLength={6}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || joinCode.length !== 6}
                    className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? 'Joining...' : 'Join Household'}
                  </button>
                </form>
              )}
            </>
          )}
      </div>
    </AdaptiveModal>
  )
}

export default HouseholdModal
